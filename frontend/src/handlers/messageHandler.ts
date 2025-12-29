import { LiveServerMessage } from '@google/genai';
import { extractFunctionCalls } from '../utils/functionCallExtractor';
import { createUILogger } from '../utils/uiLogger';
import { AppConfig } from '../utils/configLoader';
import { processFunctionCalls } from './functionCallHandler';
import { handleAudioOutput, handleInterruption } from '../audio/audioManager';
import { TimeoutManager } from '../timeout/timeoutManager';

/**
 * Context object containing all dependencies needed for message handling
 */
export interface MessageHandlerContext {
  // State references (will be mutated)
  currentUserTranscription: { value: string };
  messageSequence: { value: number };
  processedFunctionCallIds: Set<string>;
  audioSources: Set<AudioBufferSourceNode>;
  nextStartTime: { value: number };
  
  // Audio context
  outputAudioContext: AudioContext | null;
  volumeGainNode: GainNode | null;
  
  // Session (will be updated when session is available)
  session: { value: any };
  
  // UI elements
  aiFunctionCalls: HTMLTextAreaElement | null;
  
  // Configuration
  config: AppConfig;
  
  // Functions
  executeHAServiceCall: (args: any, uiElement?: HTMLTextAreaElement) => Promise<void>;
  getHAEntityState: (entityId: string, uiElement?: HTMLTextAreaElement, seq?: number) => Promise<any>;
  updateUI: (connected: boolean, status: string) => void;
  
  // Constants
  OUTPUT_SAMPLE_RATE: number;
  
  // Timeout manager
  timeoutManager: TimeoutManager;
}

/**
 * Helper function to replace audio data with placeholder in JSON
 */
function sanitizeJsonForDisplay(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeJsonForDisplay(item));
  }
  const sanitized: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      // Replace audio data in inlineData objects
      if (key === 'inlineData' && value && typeof value === 'object' && value.mimeType?.startsWith('audio/')) {
        sanitized[key] = {
          ...value,
          data: '**audio data (base64 encoded)**'
        };
      } else {
        sanitized[key] = sanitizeJsonForDisplay(value);
      }
    }
  }
  return sanitized;
}

/**
 * Create message handler function for Gemini Live API
 */
export function createMessageHandler(ctx: MessageHandlerContext) {
  return async (msg: LiveServerMessage) => {
    // Accumulate user transcription chunks as they arrive (transcription comes in separate messages)
    if (msg.serverContent?.inputTranscription?.text) {
      const transcriptionChunk = msg.serverContent.inputTranscription.text;
      const wasEmpty = ctx.currentUserTranscription.value.length === 0;
      ctx.currentUserTranscription.value += transcriptionChunk;
      
      // Start no-action timeout when user provides NEW input (only on first chunk, not every chunk)
      // We'll clear it when we get a response (audio or function call)
      if (wasEmpty) {
        ctx.timeoutManager.start();
      }
    }
    
    // Extract function calls early to check for responses
    const functionCalls = extractFunctionCalls(msg);
    
    // Clear no-action timeout when we receive any response from AI
    // We'll restart it when audio playback finishes (in audioManager.ts)
    // This prevents timeout during AI response, but ensures disconnect if user doesn't provide new input
    const hasModelTurn = !!msg.serverContent?.modelTurn;
    if (hasModelTurn || functionCalls.length > 0) {
      const hasAudio = msg.serverContent?.modelTurn?.parts?.some((p: any) => p.inlineData?.mimeType?.startsWith('audio/'));
      const hasText = msg.serverContent?.modelTurn?.parts?.some((p: any) => p.text && !p.thought);
      const hasToolCall = functionCalls.length > 0 || !!(msg.serverContent?.modelTurn as any)?.toolCall;
      
      // If we have any meaningful response, clear the timeout (only once per response)
      // The timeout will be restarted when audio finishes playing (or immediately if no audio)
      if (hasAudio || hasText || hasToolCall) {
        ctx.timeoutManager.clearWithLog();
        
        // If there's no audio (text-only or function call only), restart timeout immediately
        // For audio responses, timeout will restart when playback finishes
        if (!hasAudio) {
          ctx.timeoutManager.start();
        }
      }
    }
    
    // Log incoming messages to UI debug panel (not console to avoid audio stutter)
    if (msg.serverContent?.modelTurn) {
      const hasText = msg.serverContent.modelTurn.parts?.some((p: any) => p.text && !p.thought);
      const hasAudio = msg.serverContent.modelTurn.parts?.some((p: any) => p.inlineData?.mimeType?.startsWith('audio/'));
      const hasToolCall = !!(msg.serverContent.modelTurn as any).toolCall;
      
      // Only log to UI if it's not pure audio (to avoid spam)
      if (hasText || hasToolCall || (hasAudio && (hasText || hasToolCall))) {
        const timestamp = new Date().toISOString();
        if (ctx.aiFunctionCalls) {
          const logToUI = createUILogger(ctx.aiFunctionCalls);
          
          logToUI(`\nAI → APP (Response after function call)\n`);
          if (hasText) logToUI(`Has text response\n`);
          if (hasAudio) logToUI(`Has audio response\n`);
          if (hasToolCall) logToUI(`🔧 Has tool call\n`);
        }
      }
    }
    
    // Create sanitized version for display (without audio data)
    const sanitizedMsg = sanitizeJsonForDisplay(msg);
    const msgStr = JSON.stringify(sanitizedMsg, null, 2);
    
    // Extract modelTurn for thought signature extraction (used later)
    const modelTurn = msg.serverContent?.modelTurn as any;
    
    // Function calls already extracted above - timeout already cleared if function calls present
    
    // Extract readable content from message
    let displayContent = '';
    const timestamp = new Date().toISOString();
    // Track if we've written the header immediately (for function calls)
    let headerWrittenImmediately = false;
    let immediateHeaderSeq: number | undefined = undefined;
    
    // Check for different types of content
    if (msg.serverContent?.modelTurn?.parts) {
      const textParts = msg.serverContent.modelTurn.parts.filter(
        (part: any) => part.text && !part.thought
      );
      const thoughtParts = msg.serverContent.modelTurn.parts.filter(
        (part: any) => part.thought
      );
      const audioParts = msg.serverContent.modelTurn.parts.filter(
        (part: any) => part.inlineData?.mimeType?.startsWith('audio/')
      );
      
      // Show message if it has any interesting content OR function calls
      // Skip pure audio-only messages to avoid UI spam and audio interruption
      const isAudioOnly = audioParts.length > 0 && textParts.length === 0 && thoughtParts.length === 0 && functionCalls.length === 0;
      
      if (!isAudioOnly && (textParts.length > 0 || thoughtParts.length > 0 || functionCalls.length > 0)) {
        const seq = ++ctx.messageSequence.value;
        
        displayContent += `\nAI → APP [#${seq}]\n`;
        
        // Write AI → APP log header to UI immediately to ensure correct order
        if (ctx.aiFunctionCalls && functionCalls.length > 0) {
          const immediateLog = `\nAI → APP [#${seq}]\n`;
          ctx.aiFunctionCalls.value = ctx.aiFunctionCalls.value + immediateLog;
          ctx.aiFunctionCalls.scrollTop = ctx.aiFunctionCalls.scrollHeight;
          headerWrittenImmediately = true;
          immediateHeaderSeq = seq;
          
          // Display accumulated user transcription if available
          if (ctx.currentUserTranscription.value.trim()) {
            const transcriptionLog = `User said: "${ctx.currentUserTranscription.value.trim()}"\n`;
            ctx.aiFunctionCalls.value = ctx.aiFunctionCalls.value + transcriptionLog;
            ctx.aiFunctionCalls.scrollTop = ctx.aiFunctionCalls.scrollHeight;
            // Reset transcription for next turn
            ctx.currentUserTranscription.value = '';
          }
          
          // Also append Full JSON immediately to complete the entry before function execution
          // Note: No need for separator here since header already includes one
          const fullJsonSection = `Full JSON:\n${msgStr}\n`;
          ctx.aiFunctionCalls.value = ctx.aiFunctionCalls.value + fullJsonSection;
          ctx.aiFunctionCalls.scrollTop = ctx.aiFunctionCalls.scrollHeight;
        }
        
        if (thoughtParts.length > 0) {
          displayContent += 'Thoughts:\n';
          thoughtParts.forEach((part: any) => {
            displayContent += `${part.text || JSON.stringify(part)}\n\n`;
          });
        }
        
        if (textParts.length > 0) {
          displayContent += 'Text:\n';
          textParts.forEach((part: any) => {
            displayContent += `${part.text}\n\n`;
          });
        }
        
        // Function calls are displayed in the Full JSON section below
        // No need to show them separately here
        // NOTE: Actual execution happens in processFunctionCalls below
        
        // Show audio info only if it's mixed with other content (not pure audio-only)
        if (audioParts.length > 0 && (textParts.length > 0 || thoughtParts.length > 0 || functionCalls.length > 0)) {
          displayContent += `Audio response (${audioParts.length} part(s))\n`;
        }
      }
      // Skip pure audio-only messages - they're not useful for debugging and cause UI spam
    } else if (functionCalls.length > 0) {
      // If no parts but we found function calls, still display them
      const seq = ++ctx.messageSequence.value;
      displayContent += `\nAI → APP [#${seq}]\n`;
      // Function calls are displayed in the Full JSON section below - no need to show them separately here
      
      // Write AI → APP log header to UI immediately to ensure correct order
      if (ctx.aiFunctionCalls) {
        const immediateLog = `\nAI → APP [#${seq}]\n`;
        ctx.aiFunctionCalls.value = ctx.aiFunctionCalls.value + immediateLog;
        ctx.aiFunctionCalls.scrollTop = ctx.aiFunctionCalls.scrollHeight;
        headerWrittenImmediately = true;
        immediateHeaderSeq = seq;
        
        // Display accumulated user transcription if available
        if (ctx.currentUserTranscription.value.trim()) {
          const transcriptionLog = `User said: "${ctx.currentUserTranscription.value.trim()}"\n`;
          ctx.aiFunctionCalls.value = ctx.aiFunctionCalls.value + transcriptionLog;
          ctx.aiFunctionCalls.scrollTop = ctx.aiFunctionCalls.scrollHeight;
          // Reset transcription for next turn
          ctx.currentUserTranscription.value = '';
        }
        
        // Also append Full JSON immediately to complete the entry before function execution
        // Note: No need for separator here since header already includes one
        const fullJsonSection = `Full JSON:\n${msgStr}\n`;
        ctx.aiFunctionCalls.value = ctx.aiFunctionCalls.value + fullJsonSection;
        ctx.aiFunctionCalls.scrollTop = ctx.aiFunctionCalls.scrollHeight;
      }
    }
    
    // Process function calls (execution happens here)
    processFunctionCalls(functionCalls, msg, modelTurn, ctx);
    
    // Display content in debug panel
    if (ctx.aiFunctionCalls) {
      const existingContent = ctx.aiFunctionCalls.value;
      let contentToAdd = '';
      
      // Add readable content (text, thoughts, function calls)
      // If we already wrote the AI → APP header immediately (for function calls), skip the duplicate header
      if (displayContent) {
        // Check if the header was already written (for function calls, we write it immediately)
        if (functionCalls.length > 0 && existingContent.includes(`📥 AI → APP [${timestamp}]`)) {
          // Skip the header section (header line)
          // Find where the header ends (after the header line)
          const headerPattern = new RegExp(`📥 AI → APP \\[${timestamp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\] \\[#\\d+\\]\\n`);
          const headerMatch = displayContent.match(headerPattern);
          if (headerMatch) {
            const headerEndIndex = headerMatch.index! + headerMatch[0].length;
            // Skip everything up to and including the header line
            contentToAdd += displayContent.substring(headerEndIndex);
          } else {
            // Fallback: include everything if we can't find the marker
            contentToAdd += displayContent;
          }
        } else {
          contentToAdd += displayContent;
        }
      }
      
      // Add the full JSON (with sanitized audio data) for debugging, but skip if it's only audio
      // Show JSON if we have function calls, text, thoughts, OR if there are parts with non-audio content
      const shouldShowJson = functionCalls.length > 0 || 
        (msg.serverContent?.modelTurn?.parts && msg.serverContent.modelTurn.parts.some(
          (part: any) => part.text || part.functionCall || part.function_call
        ));
      
      if (shouldShowJson) {
        // If we've already written the header and Full JSON immediately (for function calls),
        // skip appending it again
        if (headerWrittenImmediately && immediateHeaderSeq !== undefined) {
          // Full JSON was already written immediately after the header, skip it here
          // Do nothing - the Full JSON is already in the log
        } else {
          // Normal case: add Full JSON to contentToAdd
          if (contentToAdd) {
            contentToAdd += `\nFull JSON:\n`;
          } else {
            contentToAdd += `\nAI → APP\n`;
            contentToAdd += 'Full JSON:\n';
          }
          contentToAdd += msgStr + '\n';
        }
      }
      
      // Only append contentToAdd if we haven't already written the Full JSON directly
      if (contentToAdd && !(headerWrittenImmediately && shouldShowJson)) {
        const newValue = existingContent 
          ? `${existingContent}\n\n${contentToAdd}`
          : contentToAdd;
        ctx.aiFunctionCalls.value = newValue;
        ctx.aiFunctionCalls.scrollTop = ctx.aiFunctionCalls.scrollHeight;
        // Removed verbose logging to avoid interrupting audio playback
      }
    }

    // Handle Audio Output - check all parts for audio, not just the first one
    const audioParts = msg.serverContent?.modelTurn?.parts?.filter((p: any) => 
      p.inlineData?.mimeType?.startsWith('audio/')
    ) || [];
    
    if (audioParts.length > 0 && ctx.outputAudioContext) {
      // Timeout is already cleared above when we detected modelTurn with audio
      // Just process the audio parts
      for (const part of audioParts) {
        if (part.inlineData?.data) {
          await handleAudioOutput(part.inlineData.data, ctx);
        }
      }
    }

    // Handle Interruption
    if (msg.serverContent?.interrupted) {
      handleInterruption(ctx);
      // After interruption, restart timeout if user has provided input (they're waiting for a response)
      if (ctx.currentUserTranscription.value.trim().length > 0) {
        ctx.timeoutManager.start();
      }
    }
  };
}

