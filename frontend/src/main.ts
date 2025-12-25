import './styles.css';
import { GoogleGenAI, Modality, StartSensitivity, EndSensitivity } from '@google/genai';
import { pcmToGeminiBlob } from './utils/audioUtils';
import { buildSystemInstruction as buildSystemInstructionUtil, buildTools as buildToolsUtil } from './utils/geminiConfigBuilder';
import { executeHAServiceCall as executeHAServiceCallApi, getHAEntityState as getHAEntityStateApi } from './api/haRestApi';
import { createUILogger } from './utils/uiLogger';
import { loadConfig } from './utils/configLoader';
import { getHAWebSocketUrl } from './utils/haUrlBuilder';
import { updateHAConfigFromTextarea, extractHAConfigFromHomeAssistant } from './utils/haConfigManager';
import { updateUIState, copyToClipboard, updateMuteState } from './utils/uiHelpers';
import { createMessageHandler, MessageHandlerContext } from './handlers/messageHandler';
import { TimeoutManager } from './timeout/timeoutManager';
import { ApplicationState, createInitialState } from './state/applicationState';
import { saveConfigToStorage, loadConfigFromStorage } from './utils/configManager';

// Load configuration (can be reloaded after UI changes)
let config = loadConfig();

// Debug: Log the final config to verify it's loaded correctly
console.log('Final loaded config:', {
  baseUrl: config.homeAssistant.baseUrl,
  hasAccessToken: !!config.homeAssistant.accessToken,
  accessTokenLength: config.homeAssistant.accessToken?.length || 0,
  accessTokenPreview: config.homeAssistant.accessToken ? 
    `${config.homeAssistant.accessToken.substring(0, 10)}...` : 'MISSING'
});

// Helper functions

/**
 * Test WebSocket connection directly - for debugging
 * Exposed to window for console testing
 */
(window as any).testHAWebSocket = function(token?: string) {
  const testToken = token || config.homeAssistant.accessToken;
  const wsUrl = getHAWebSocketUrl(config.homeAssistant.baseUrl);
  
  console.log('🧪 Testing WebSocket connection:');
  console.log('  URL:', wsUrl);
  console.log('  Token length:', testToken?.length || 0);
  console.log('  Token preview:', testToken ? `${testToken.substring(0, 10)}...` : 'MISSING');
  
  const ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('✅ WebSocket opened! Sending auth...');
    ws.send(JSON.stringify({ type: "auth", access_token: testToken }));
  };
  
  ws.onmessage = (event) => {
    console.log('📨 WebSocket message:', JSON.parse(event.data));
  };
  
  ws.onerror = (error) => {
    console.error('❌ WebSocket error:', error);
  };
  
  ws.onclose = (event) => {
    console.log('🔌 WebSocket closed:', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean
    });
  };
  
  return ws;
};


// Audio constants
const INPUT_SAMPLE_RATE = 48000; // Default browser sample rate (used as fallback only - actual rate comes from AudioContext)
const OUTPUT_SAMPLE_RATE = config.audio.outputSampleRate;

// Application state
const appState: ApplicationState = createInitialState();

// Timeout manager
let timeoutManager: TimeoutManager | null = null;


// UI Elements
const micButton = document.getElementById('mic-button') as HTMLButtonElement;
const muteButton = document.getElementById('mute-button') as HTMLButtonElement;
const statusText = document.getElementById('status-text') as HTMLParagraphElement;
const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement | null;
const volumeMuteButton = document.getElementById('volume-mute-button') as HTMLButtonElement | null;
const settingsIcon = document.getElementById('settings-icon') as HTMLButtonElement | null;
const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement | null;
const settingsOverlay = document.getElementById('settings-overlay') as HTMLDivElement | null;
const settingsCloseBtn = document.getElementById('settings-close-btn') as HTMLButtonElement | null;
const settingsTabs = document.querySelectorAll('.settings-tab') as NodeListOf<HTMLButtonElement>;
const geminiTab = document.getElementById('gemini-tab') as HTMLDivElement | null;
const homeAssistantTab = document.getElementById('homeassistant-tab') as HTMLDivElement | null;
const docsTab = document.getElementById('docs-tab') as HTMLDivElement | null;
const debugTab = document.getElementById('debug-tab') as HTMLDivElement | null;
const haConfigInput = document.getElementById('ha-config-input') as HTMLTextAreaElement | null;
const extractHaConfigBtn = document.getElementById('extract-ha-config-btn') as HTMLButtonElement | null;
const extractStatus = document.getElementById('extract-status') as HTMLDivElement | null;
const haConfigSummary = document.getElementById('ha-config-summary') as HTMLDivElement | null;
const haConfigSummarySection = document.getElementById('ha-config-summary-section') as HTMLDivElement | null;
const aiFunctionCalls = document.getElementById('ai-function-calls') as HTMLTextAreaElement | null;
const copyLogBtn = document.getElementById('copy-log-btn') as HTMLButtonElement | null;

// HA config and states are now stored in appState

/**
 * Update UI state
 * Wrapper function that uses the utility module
 */
function updateUI(connected: boolean, status: string) {
  appState.isConnected = connected;
  updateUIState(micButton, statusText, connected, status, muteButton);
  // Initialize or reset mute state
  if (connected) {
    // When connecting, ensure mute button shows correct state (not muted = show mute icon)
    if (!appState.isMicMuted) {
      updateMuteState(muteButton, false);
    }
  } else {
    // Reset mute state when disconnecting
    appState.isMicMuted = false;
    updateMuteState(muteButton, false);
    micButton.classList.remove('muted');
  }
}

/**
 * Handle volume slider changes (from dragging or input events)
 */
function handleVolumeChange() {
  if (!volumeSlider) {
    console.warn('Volume slider element not found');
    return;
  }
  
  const volume = parseFloat(volumeSlider.value);
  setVolume(volume);
}

/**
 * Set volume to a specific value (0-100)
 */
function setVolume(volume: number) {
  if (!volumeSlider) return;
  
  // Clamp volume to 0-100
  volume = Math.max(0, Math.min(100, volume));
  volumeSlider.value = volume.toString();
  
  const volumePercent = volume / 100; // Convert 0-100 to 0-1
  
  // Save to localStorage
  localStorage.setItem('tiddelihome_volume', volume.toString());
  
  // Update volume mute button icon state
  updateVolumeMuteButtonState(volume);
  
  // Update gain node if it exists (audio context is active)
  if (appState.volumeGainNode) {
    appState.volumeGainNode.gain.value = volumePercent;
    console.log(`Volume changed to ${volume}% (${volumePercent}), gain node updated`);
  } else {
    console.log(`Volume changed to ${volume}% (${volumePercent}), saved to localStorage (gain node not yet created - will apply on connect)`);
  }
}

/**
 * Update volume mute button icon state based on volume level
 */
function updateVolumeMuteButtonState(volume: number) {
  if (!volumeMuteButton) return;
  
  if (volume === 0) {
    volumeMuteButton.classList.add('muted');
    volumeMuteButton.setAttribute('aria-label', 'Unmute volume');
  } else {
    volumeMuteButton.classList.remove('muted');
    volumeMuteButton.setAttribute('aria-label', 'Mute volume');
  }
}

/**
 * Toggle volume mute (0 if not muted, restore previous value if muted)
 */
function toggleVolumeMute() {
  if (!volumeSlider) return;
  
  const currentVolume = parseFloat(volumeSlider.value);
  
  if (currentVolume === 0) {
    // Unmute: restore to last saved non-zero volume or default to 80
    const lastVolume = parseFloat(localStorage.getItem('tiddelihome_last_volume') || '80');
    setVolume(lastVolume);
  } else {
    // Mute: save current volume and set to 0
    localStorage.setItem('tiddelihome_last_volume', currentVolume.toString());
    setVolume(0);
  }
}

/**
 * Handle volume slider track clicks (jump to mute or max)
 */
function handleVolumeSliderClick(event: MouseEvent) {
  if (!volumeSlider) return;
  
  const rect = volumeSlider.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const trackWidth = rect.width;
  const clickPercent = clickX / trackWidth;
  
  // Threshold: if click is within 10% of either end, jump to that endpoint
  const threshold = 0.1;
  
  if (clickPercent <= threshold) {
    // Clicked near start - set to mute (0)
    setVolume(0);
  } else if (clickPercent >= (1 - threshold)) {
    // Clicked near end - set to max (100)
    setVolume(100);
  } else {
    // Clicked in middle - calculate value based on position
    const newVolume = Math.round(clickPercent * 100);
    setVolume(newVolume);
  }
}

/**
 * Toggle microphone mute state
 */
function toggleMute() {
  if (!appState.isConnected) return;
  
  appState.isMicMuted = !appState.isMicMuted;
  updateMuteState(muteButton, appState.isMicMuted);
  
  // Update mic button visual state
  if (appState.isMicMuted) {
    micButton.classList.add('muted');
    statusText.textContent = 'Microphone muted - Click unmute to resume';
  } else {
    micButton.classList.remove('muted');
    statusText.textContent = 'Listening...';
  }
}

/**
 * Copy AI function calls log to clipboard
 * Wrapper function that uses the utility module
 */
async function copyLogToClipboard() {
  if (!aiFunctionCalls) return;
  
  try {
    await copyToClipboard(aiFunctionCalls.value, copyLogBtn || undefined, 2000); // 2 second feedback duration
  } catch (err) {
    // Error is already handled by copyToClipboard
  }
}

// Set up copy button click handler
if (copyLogBtn) {
  copyLogBtn.addEventListener('click', copyLogToClipboard);
}

/**
 * Toggle settings panel visibility
 */
function toggleSettingsPanel(event?: Event) {
  if (!settingsPanel || !settingsOverlay) return;
  
  // Check if the click is from the close button (allow closing)
  const isCloseButton = event && event.target && 
    (event.target as HTMLElement).id === 'settings-close-btn';
  
  // If event is from panel content (but NOT the close button), don't close
  if (event && event.target && settingsPanel.contains(event.target as Node) && !isCloseButton) {
    return;
  }
  
  const isOpen = settingsPanel.classList.contains('open');
  if (isOpen) {
    settingsPanel.classList.remove('open');
    settingsOverlay.classList.remove('visible');
    // Show settings icon when panel closes
    if (settingsIcon) {
      settingsIcon.classList.remove('js-hidden');
    }
  } else {
    settingsPanel.classList.add('open');
    settingsOverlay.classList.add('visible');
    // Hide settings icon when panel opens
    if (settingsIcon) {
      settingsIcon.classList.add('js-hidden');
    }
    // Initialize to Gemini tab when opening
    switchTab('gemini');
  }
}

/**
 * Switch between tabs
 */
function switchTab(tabName: 'gemini' | 'homeassistant' | 'docs' | 'debug') {
  // Update tab buttons
  settingsTabs.forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // Update tab content - hide all first
  [geminiTab, homeAssistantTab, docsTab, debugTab].forEach(tab => {
    if (tab) tab.classList.remove('active');
  });
  
  // Show selected tab
  if (tabName === 'gemini' && geminiTab) {
    geminiTab.classList.add('active');
    loadGeminiConfig(); // Load config when tab is shown
  } else if (tabName === 'homeassistant' && homeAssistantTab) {
    homeAssistantTab.classList.add('active');
  } else if (tabName === 'docs' && docsTab) {
    docsTab.classList.add('active');
  } else if (tabName === 'debug' && debugTab) {
    debugTab.classList.add('active');
  }
}

/**
 * Parse and store HA config from textarea
 * Wrapper function that uses the utility module
 */
function updateHAConfig() {
  if (!haConfigInput) return;
  
  const result = updateHAConfigFromTextarea(
    haConfigInput,
    (config) => { appState.haConfig = config; },
    (error) => { 
      appState.haConfig = null;
      updateUI(false, error);
    },
    haConfigSummary || undefined,
    haConfigSummarySection || undefined
  );
  
  if (result === null && haConfigInput.value.trim() === '') {
    appState.haConfig = null;
  } else {
    appState.haConfig = result;
  }
}

/**
 * Extract HA config from Home Assistant via WebSocket
 * Wrapper function that uses the utility module
 */
async function extractHAConfig() {
  if (!extractHaConfigBtn || !extractStatus || !haConfigInput) return;

  const messageSequenceRef = { value: appState.messageSequence };
  const result = await extractHAConfigFromHomeAssistant(
    config,
    extractHaConfigBtn,
    extractStatus,
    haConfigInput,
    aiFunctionCalls || undefined,
    messageSequenceRef,
    (config) => { appState.haConfig = config; }, // Store config only (no states)
    (_error) => { 
      appState.haConfig = null;
      appState.haStates = null; // Clear states on error
      // Hide summary on error
      if (haConfigSummarySection) {
        haConfigSummarySection.classList.remove('js-block');
        haConfigSummarySection.classList.add('js-hidden');
      }
    },
    haConfigSummary || undefined,
    haConfigSummarySection || undefined,
    (states) => { appState.haStates = states; } // Store states separately
  );
  
  appState.haConfig = result;
  appState.messageSequence = messageSequenceRef.value;
}


/**
 * Execute Home Assistant service call
 * Wrapper function that uses the API module
 */
async function executeHAServiceCall(args: any, uiElement?: HTMLTextAreaElement): Promise<void> {
  const seq = ++appState.messageSequence;
  await executeHAServiceCallApi(
    {
      baseUrl: config.homeAssistant.baseUrl,
      accessToken: config.homeAssistant.accessToken
    },
    args,
    uiElement,
    seq
  );
}

/**
 * Query Home Assistant entity state
 * Wrapper function that uses the API module
 */
async function getHAEntityState(entityId: string, uiElement?: HTMLTextAreaElement, seq?: number): Promise<any> {
  // Use provided sequence number or assign a new one
  const sequenceNum = seq !== undefined ? seq : ++appState.messageSequence;
  return await getHAEntityStateApi(
    {
      baseUrl: config.homeAssistant.baseUrl,
      accessToken: config.homeAssistant.accessToken
    },
    entityId,
    uiElement,
    sequenceNum
  );
}

/**
 * Build system instruction with HA config
 * Wrapper function that uses the utility module
 */
function buildSystemInstruction(): string {
  return buildSystemInstructionUtil(config.gemini.systemInstruction, appState.haConfig, config);
}

/**
 * Build tools definition for Gemini function calling
 * Wrapper function that uses the utility module
 */
function buildTools() {
  return buildToolsUtil(config);
}

/**
 * Connect to Gemini Live API
 */
async function connectToGemini() {
  if (!config.gemini.apiKey) {
    updateUI(false, 'Error: Missing API Key. Please set VITE_GEMINI_API_KEY in .env file');
    return;
  }

  // Don't connect if already connected
  if (appState.isConnected) {
    return;
  }

  // Initialize timeout manager
  if (!timeoutManager) {
    timeoutManager = new TimeoutManager(
      config.ui?.noActionTimeout || 10000,
      {
        onTimeout: () => {
          if (aiFunctionCalls) {
            const logToUI = createUILogger(aiFunctionCalls);
            const timestamp = new Date().toISOString();
            logToUI(`\n⏱️ Timeout [${timestamp}]\n`);
            logToUI(`   No user input received after ${config.ui?.noActionTimeout || 10000}ms\n`);
            logToUI(`   Disconnecting to prevent indefinite session...\n`);
          }
          updateUI(false, 'Timeout: No user activity');
          disconnect();
        }
      }
    );
  }

  try {
    console.log('Starting connection...', {
      apiKey: config.gemini.apiKey ? `${config.gemini.apiKey.substring(0, 10)}...` : 'missing',
      model: config.gemini.model
    });
    updateUI(true, 'Connecting...');

    // Initialize Audio Contexts
    // Note: Browsers may ignore the sampleRate parameter and use their default.
    // We'll use the AudioContext's actual sampleRate property after creation.
    appState.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    appState.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
      sampleRate: OUTPUT_SAMPLE_RATE 
    });

    console.log(`Created inputAudioContext with actual sample rate: ${appState.inputAudioContext.sampleRate} Hz`);
    console.log(`Created outputAudioContext with actual sample rate: ${appState.outputAudioContext.sampleRate} Hz`);

    // Create gain node for volume control and connect to destination
    const savedVolume = parseFloat(localStorage.getItem('tiddelihome_volume') || '80');
    appState.volumeGainNode = appState.outputAudioContext.createGain();
    appState.volumeGainNode.gain.value = savedVolume / 100; // Convert 0-100 to 0-1
    appState.volumeGainNode.connect(appState.outputAudioContext.destination);

    // Get User Media (microphone)
    // Note: getUserMedia requires HTTPS or localhost for security reasons
    // Accessing via IP address (e.g., http://192.168.1.100:3000) will fail
    try {
      // Try to request 16kHz sample rate (browser may ignore this)
      const audioConstraints: MediaTrackConstraints = {
        sampleRate: { ideal: 16000 }
      };
      
      appState.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      
      // Check what sample rate we actually got
      const audioTrack = appState.stream.getAudioTracks()[0];
      const actualSettings = audioTrack.getSettings();
      console.log('Microphone access granted');
      console.log('Requested sample rate: 16000 Hz (ideal)');
      console.log('Actual sample rate from MediaStream:', actualSettings.sampleRate || 'unknown');
      
      updateUI(true, 'Setting up connection...');
    } catch (mediaError: any) {
      const isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      
      if (!isSecureContext && (location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/) || location.hostname.includes('.'))) {
        // Build localhost URL using current protocol and port
        const port = location.port ? `:${location.port}` : '';
        const localhostUrl = `${location.protocol}//localhost${port}`;
        const errorMsg = `Microphone access blocked: Browser requires HTTPS or localhost for microphone access.\n\n` +
                        `Current URL: ${location.href}\n\n` +
                        `Solutions:\n` +
                        `1. Use localhost instead: ${localhostUrl}\n` +
                        `2. Set up HTTPS (recommended for production)\n` +
                        `3. Use a reverse proxy with SSL certificate`;
        console.error(errorMsg);
        updateUI(false, `Error: Microphone access requires HTTPS or localhost. Current: ${location.hostname}`);
        throw new Error(errorMsg);
      } else {
        // Other getUserMedia errors (permission denied, etc.)
        throw mediaError;
      }
    }

    // Initialize Gemini
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    console.log('GoogleGenAI initialized');

    // Build tools array
    const tools = buildTools();
    
    // Add Google Search tool if grounding is enabled
    // Note: Google Search must be added as a tool, not as a grounding property
    if (config.gemini.enableGrounding) {
      tools.push({
        googleSearch: {}
      });
    }
    
    // Build config object
    const connectConfig: any = {
      systemInstruction: buildSystemInstruction(),
      responseModalities: [Modality.AUDIO],
      tools: tools,
      inputAudioTranscription: {}, // Enable transcription of user's audio input
    };
    
    // Add affective dialog if enabled
    if (config.gemini.enableAffectiveDialog) {
      connectConfig.enableAffectiveDialog = true;
    }
    
    // Add voice configuration if specified
    if (config.gemini.voiceName) {
      connectConfig.speechConfig = {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: config.gemini.voiceName
          }
        }
      };
    }
    
    // Add language code if specified
    if (config.gemini.languageCode) {
      connectConfig.languageCode = config.gemini.languageCode;
    }
    
    // Add proactive audio if enabled
    if (config.gemini.proactiveAudio) {
      connectConfig.proactivity = {
        proactiveAudio: true
      };
    }
    
    // Add thinking config if enabled
    if (config.gemini.thinkingConfig?.enabled) {
      const thinkingConfig: any = {};
      
      // Only include thinkingBudget if explicitly set (not undefined/null/0)
      // If omitted, Gemini uses dynamic thinking (default behavior)
      if (config.gemini.thinkingConfig.thinkingBudget !== undefined && 
          config.gemini.thinkingConfig.thinkingBudget !== null) {
        thinkingConfig.thinkingBudget = config.gemini.thinkingConfig.thinkingBudget;
      }
      
      // Include thoughts flag
      thinkingConfig.includeThoughts = config.gemini.thinkingConfig.includeThoughts || false;
      
      connectConfig.thinkingConfig = thinkingConfig;
    }
    
    // Add VAD (Voice Activity Detection) config
    if (config.gemini.vadConfig) {
      const vadConfig: any = {};
      
      // Map sensitivity strings to enum values
      const startSensitivityMap: Record<string, any> = {
        'START_SENSITIVITY_LOW': StartSensitivity.START_SENSITIVITY_LOW,
        'START_SENSITIVITY_MEDIUM': StartSensitivity.START_SENSITIVITY_MEDIUM,
        'START_SENSITIVITY_HIGH': StartSensitivity.START_SENSITIVITY_HIGH,
      };
      
      const endSensitivityMap: Record<string, any> = {
        'END_SENSITIVITY_LOW': EndSensitivity.END_SENSITIVITY_LOW,
        'END_SENSITIVITY_MEDIUM': EndSensitivity.END_SENSITIVITY_MEDIUM,
        'END_SENSITIVITY_HIGH': EndSensitivity.END_SENSITIVITY_HIGH,
      };
      
      if (config.gemini.vadConfig.disabled !== undefined) {
        vadConfig.disabled = config.gemini.vadConfig.disabled;
      }
      
      if (config.gemini.vadConfig.startOfSpeechSensitivity) {
        vadConfig.startOfSpeechSensitivity = startSensitivityMap[config.gemini.vadConfig.startOfSpeechSensitivity] || StartSensitivity.START_SENSITIVITY_MEDIUM;
      }
      
      if (config.gemini.vadConfig.endOfSpeechSensitivity) {
        vadConfig.endOfSpeechSensitivity = endSensitivityMap[config.gemini.vadConfig.endOfSpeechSensitivity] || EndSensitivity.END_SENSITIVITY_MEDIUM;
      }
      
      if (config.gemini.vadConfig.prefixPaddingMs !== undefined) {
        vadConfig.prefixPaddingMs = config.gemini.vadConfig.prefixPaddingMs;
      }
      
      if (config.gemini.vadConfig.silenceDurationMs !== undefined) {
        vadConfig.silenceDurationMs = config.gemini.vadConfig.silenceDurationMs;
      }
      
      connectConfig.realtimeInputConfig = {
        automaticActivityDetection: vadConfig
      };
    }
    
    // Create session ref for message handler (will be updated in onopen)
    const sessionRef = { value: null as any };
    
    // Create message handler context
    const messageHandlerContext: MessageHandlerContext = {
      // State references (wrapped in objects for mutation)
      currentUserTranscription: { value: appState.currentUserTranscription },
      messageSequence: { value: appState.messageSequence },
      processedFunctionCallIds: appState.processedFunctionCallIds,
      audioSources: appState.audioSources,
      nextStartTime: { value: appState.nextStartTime },
      
      // Audio context
      outputAudioContext: appState.outputAudioContext,
      volumeGainNode: appState.volumeGainNode,
      
      // Session (will be updated when session is available)
      session: sessionRef,
      
      // UI elements
      aiFunctionCalls: aiFunctionCalls,
      
      // Configuration
      config: config,
      
      // Functions
      executeHAServiceCall: executeHAServiceCall,
      getHAEntityState: getHAEntityState,
      updateUI: updateUI,
      
      // Constants
      OUTPUT_SAMPLE_RATE: OUTPUT_SAMPLE_RATE,
      
      // Timeout manager
      timeoutManager: timeoutManager!,
    };
    
    appState.sessionPromise = ai.live.connect({
      model: config.gemini.model,
      config: connectConfig,
      callbacks: {
        onopen: () => {
          console.log('Gemini Live Connected - onopen callback');
          
          // Wait for session promise to resolve
          if (!appState.sessionPromise) {
            console.error('No session promise available');
            return;
          }

          appState.sessionPromise.then(async (s: any) => {
            console.log('Session promise resolved, session:', s);
            console.log('Session methods:', Object.keys(s || {}));
            appState.session = s;
            sessionRef.value = s; // Update session ref for message handler
            if (!appState.session || !appState.inputAudioContext || !appState.stream) {
              console.error('Failed to get session or audio context', {
                session: !!appState.session,
                inputAudioContext: !!appState.inputAudioContext,
                stream: !!appState.stream
              });
              disconnect();
              return;
            }

            // Setup Input Stream using AudioWorklet (replaces deprecated ScriptProcessorNode)
            try {
              // Load AudioWorklet module
              await appState.inputAudioContext.audioWorklet.addModule('/audio-processor.js');
              
              appState.sourceNode = appState.inputAudioContext.createMediaStreamSource(appState.stream);
              appState.processor = new AudioWorkletNode(appState.inputAudioContext, 'audio-processor');

              // Handle messages from the AudioWorklet processor
              appState.processor.port.onmessage = (e: MessageEvent) => {
                // Only send if still connected, session exists, and microphone is not muted
                if (!appState.isConnected || !appState.session || appState.isMicMuted) return;
                
                if (e.data.type === 'audioData') {
                  try {
                    const inputData = e.data.data as Float32Array;
                    // Use the actual AudioContext sample rate (browser may use different than requested)
                    const actualSampleRate = appState.inputAudioContext?.sampleRate || INPUT_SAMPLE_RATE;
                    const blob = pcmToGeminiBlob(inputData, actualSampleRate);
                    appState.session.sendRealtimeInput({ media: blob });
                  } catch (error) {
                    // Silently ignore errors if connection is closing/closed
                    if (error instanceof Error && !error.message.includes('CLOSING') && !error.message.includes('CLOSED')) {
                      console.error('Error sending audio:', error);
                    }
                  }
                }
              };

              // Connect audio nodes: source -> processor -> gainNode (at 0 volume) -> destination
              // AudioWorkletNode must be connected to process audio, but we don't want to hear our own input
              // So we use a GainNode set to 0 to prevent feedback while still processing the audio
              const gainNode = appState.inputAudioContext.createGain();
              gainNode.gain.value = 0; // Mute to prevent feedback
              
              appState.sourceNode.connect(appState.processor);
              appState.processor.connect(gainNode);
              gainNode.connect(appState.inputAudioContext.destination);
              
              console.log('Audio pipeline connected:', {
                contextSampleRate: appState.inputAudioContext.sampleRate,
                usingSampleRate: appState.inputAudioContext.sampleRate
              });
              
              updateUI(true, 'Listening...');
              
              // Send initial greeting if configured
              if (config.gemini.initialGreeting?.enabled && config.gemini.initialGreeting?.message) {
                try {
                  await appState.session.sendClientContent({
                    turns: {
                      role: 'user',
                      parts: [{ text: config.gemini.initialGreeting.message }]
                    },
                    turnComplete: true
                  });
                } catch (error) {
                  console.error('Error sending initial greeting:', error);
                  // Don't disconnect on greeting error - connection is still valid
                }
              }
            } catch (error) {
              console.error('Error setting up audio:', error);
              updateUI(false, 'Error setting up audio');
              disconnect();
            }
          }).catch((error: any) => {
            console.error('Error getting session:', error);
            updateUI(false, 'Error connecting');
            disconnect();
          });
        },
        onmessage: createMessageHandler(messageHandlerContext),
        onclose: (event) => {
          console.log('Gemini Live Closed', event);
          console.trace('Close stack trace');
          
          // Log closure details to UI debug panel
          if (aiFunctionCalls) {
            const timestamp = new Date().toISOString();
            const logToUI = createUILogger(aiFunctionCalls || undefined);
            
            logToUI(`\n🔌 Connection Closed [${timestamp}]\n`);
            logToUI(`   Code: ${event.code}\n`);
            logToUI(`   Reason: ${event.reason || '(none)'}\n`);
            logToUI(`   Was clean: ${event.wasClean}\n`);
            logToUI(`   Processed function calls: ${appState.processedFunctionCallIds.size}\n`);
            
            // Detailed closure code interpretation
            if (event.code === 1000) {
              logToUI(`   ⚠️ Normal closure (1000) - This usually means:\n`);
              logToUI(`      - Gemini server closed the connection intentionally\n`);
              logToUI(`      - May indicate function response rejection or rate limiting\n`);
              logToUI(`      - Can happen with rapid/multiple function calls\n`);
            } else if (event.code === 1001) {
              logToUI(`   ⚠️ Going Away (1001) - Server is shutting down or restarting\n`);
            } else if (event.code === 1002) {
              logToUI(`   ❌ Protocol Error (1002) - Invalid data received\n`);
            } else if (event.code === 1003) {
              logToUI(`   ❌ Unsupported Data (1003) - Data format not supported\n`);
            } else if (event.code === 1006) {
              logToUI(`   ❌ Abnormal Closure (1006) - Connection lost without close frame\n`);
            } else if (event.code === 1011) {
              logToUI(`   ❌ Server Error (1011) - Gemini server encountered an internal error\n`);
              logToUI(`      - This is a server-side issue, not necessarily caused by the client\n`);
              logToUI(`      - May be related to:\n`);
              logToUI(`        • Thinking/thoughts processing\n`);
              logToUI(`        • Function response handling\n`);
              logToUI(`        • Server load or temporary issues\n`);
              logToUI(`      - Recommendation: Try reconnecting. If persistent, consider:\n`);
              logToUI(`        • Temporarily disabling thinking feature (thinkingConfig.enabled = false)\n`);
              logToUI(`        • Waiting a few moments before retrying\n`);
            } else if (event.code >= 4000) {
              logToUI(`   ⚠️ Custom/Application Error (${event.code}) - Check Gemini API documentation\n`);
            }
          }
          
          appState.session = null; // Clear session reference
          // Only update UI if we were actually connected
          if (appState.isConnected) {
            updateUI(false, 'Disconnected');
          }
        },
        onerror: (err) => {
          console.error('Gemini Live Error', err);
          console.error('Error details:', JSON.stringify(err, null, 2));
          appState.session = null;
          const errorMsg = err instanceof Error ? err.message : String(err);
          updateUI(false, `Connection error: ${errorMsg}`);
          // Auto-disconnect on error (100ms delay to allow error logging)
          setTimeout(() => disconnect(), 100);
        },
      },
    });

  } catch (e) {
    console.error(e);
    updateUI(false, `Error: ${e instanceof Error ? e.message : 'Failed to connect'}`);
  }
}

/**
 * Disconnect from Gemini
 */
function disconnect() {
  // Set connected to false first to stop audio processing
  appState.isConnected = false;
  // Clear processed function call IDs when disconnecting
  appState.processedFunctionCallIds.clear();
  // Reset message sequence counter
  appState.messageSequence = 0;
  // Reset transcription accumulator
  appState.currentUserTranscription = '';

  // Stop audio tracks
  if (appState.stream) {
    appState.stream.getTracks().forEach(t => t.stop());
    appState.stream = null;
  }

  // Disconnect audio nodes (this stops the processor from sending)
  if (appState.processor && appState.sourceNode) {
    try {
      appState.sourceNode.disconnect();
      appState.processor.disconnect();
      // Close the AudioWorkletNode port if it exists
      if (appState.processor.port) {
        appState.processor.port.close();
      }
    } catch (e) {
      // Ignore errors during disconnect
    }
    appState.processor = null;
    appState.sourceNode = null;
  }

  // Close audio contexts
  if (appState.inputAudioContext) {
    appState.inputAudioContext.close().catch(() => {});
    appState.inputAudioContext = null;
  }
  if (appState.outputAudioContext) {
    appState.outputAudioContext.close().catch(() => {});
    appState.outputAudioContext = null;
  }
  
  // Clear volume gain node
  appState.volumeGainNode = null;

  // Stop all audio sources
  appState.audioSources.forEach(s => {
    try {
      s.stop();
    } catch (e) {
      // Ignore errors
    }
  });
  appState.audioSources.clear();

  // Close session
  if (appState.session && typeof appState.session.close === 'function') {
    try {
      appState.session.close();
    } catch (e) {
      // Ignore errors
    }
  }
  appState.session = null;
  appState.sessionPromise = null;

  appState.nextStartTime = 0;
  
  // Clear no-action timeout on disconnect
  if (timeoutManager) {
    timeoutManager.clear();
  }
  
  updateUI(false, 'Ready - Click to start call');
}

/**
 * Toggle connection
 */
function toggleConnection() {
  if (appState.isConnected) {
    disconnect();
  } else {
    connectToGemini();
  }
}

// Initialize volume slider
const savedVolume = parseFloat(localStorage.getItem('tiddelihome_volume') || '80');
if (volumeSlider) {
  volumeSlider.value = savedVolume.toString();
  volumeSlider.addEventListener('input', handleVolumeChange);
  volumeSlider.addEventListener('change', handleVolumeChange); // Also listen to change event for better compatibility
  volumeSlider.addEventListener('click', handleVolumeSliderClick); // Handle track clicks for mute/max
  updateVolumeMuteButtonState(savedVolume); // Initialize mute button state
  console.log('Volume slider initialized with value:', savedVolume);
} else {
  console.error('Volume slider element not found!');
}

// Initialize volume mute button
if (volumeMuteButton) {
  volumeMuteButton.addEventListener('click', toggleVolumeMute);
}

// Initialize
micButton.addEventListener('click', toggleConnection);
muteButton.addEventListener('click', toggleMute);
updateUI(false, 'Ready - Click to start call');

// Settings panel initialization and event listeners
if (settingsIcon) {
  settingsIcon.addEventListener('click', toggleSettingsPanel);
}
if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent overlay click handler from firing
    toggleSettingsPanel(e);
  });
}
if (settingsOverlay) {
  settingsOverlay.addEventListener('click', toggleSettingsPanel);
}

// Tab switching
settingsTabs.forEach(tab => {
  tab.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent overlay click handler from firing
    const tabName = tab.dataset.tab as 'gemini' | 'homeassistant' | 'docs' | 'debug';
    if (tabName) {
      switchTab(tabName);
    }
  });
});
if (haConfigInput) {
  haConfigInput.addEventListener('input', (e) => {
    e.stopPropagation();
    updateHAConfig();
  });
  haConfigInput.addEventListener('blur', (e) => {
    e.stopPropagation();
    updateHAConfig();
  });
}

// Gemini configuration UI
const geminiApiKeyInput = document.getElementById('gemini-api-key') as HTMLInputElement | null;
const geminiModelInput = document.getElementById('gemini-model') as HTMLInputElement | null;
const geminiVoiceNameInput = document.getElementById('gemini-voice-name') as HTMLInputElement | null;
const geminiLanguageCodeInput = document.getElementById('gemini-language-code') as HTMLInputElement | null;
const geminiEnableGroundingCheckbox = document.getElementById('gemini-enable-grounding') as HTMLInputElement | null;
const geminiEnableAffectiveDialogCheckbox = document.getElementById('gemini-enable-affective-dialog') as HTMLInputElement | null;
const geminiProactiveAudioCheckbox = document.getElementById('gemini-proactive-audio') as HTMLInputElement | null;
const geminiThinkingEnabledCheckbox = document.getElementById('gemini-thinking-enabled') as HTMLInputElement | null;
const geminiThinkingBudgetInput = document.getElementById('gemini-thinking-budget') as HTMLInputElement | null;
const geminiInitialGreetingEnabledCheckbox = document.getElementById('gemini-initial-greeting-enabled') as HTMLInputElement | null;
const geminiInitialGreetingMessageTextarea = document.getElementById('gemini-initial-greeting-message') as HTMLTextAreaElement | null;
const geminiVadDisabledCheckbox = document.getElementById('gemini-vad-disabled') as HTMLInputElement | null;
const geminiVadStartSensitivitySelect = document.getElementById('gemini-vad-start-sensitivity') as HTMLSelectElement | null;
const geminiVadEndSensitivitySelect = document.getElementById('gemini-vad-end-sensitivity') as HTMLSelectElement | null;
const geminiVadPrefixPaddingInput = document.getElementById('gemini-vad-prefix-padding') as HTMLInputElement | null;
const geminiVadSilenceDurationInput = document.getElementById('gemini-vad-silence-duration') as HTMLInputElement | null;
const saveGeminiConfigBtn = document.getElementById('save-gemini-config-btn') as HTMLButtonElement | null;
const geminiConfigStatus = document.getElementById('gemini-config-status') as HTMLDivElement | null;

/**
 * Load Gemini configuration from localStorage and populate form fields
 * Uses config.json defaults when no saved config exists
 */
function loadGeminiConfig() {
  const userConfig = loadConfigFromStorage();
  const geminiConfig = userConfig?.gemini;
  
  // Use defaults from config.json when no saved config exists
  const defaults = config.gemini;
  
  // Populate form fields - use saved config if available, otherwise use defaults
  if (geminiApiKeyInput) {
    geminiApiKeyInput.value = geminiConfig?.apiKey || defaults.apiKey || '';
  }
  if (geminiModelInput) {
    geminiModelInput.value = geminiConfig?.model || defaults.model || '';
  }
  if (geminiVoiceNameInput) {
    geminiVoiceNameInput.value = geminiConfig?.voiceName || defaults.voiceName || '';
  }
  if (geminiLanguageCodeInput) {
    geminiLanguageCodeInput.value = geminiConfig?.languageCode || defaults.languageCode || '';
  }
  if (geminiEnableGroundingCheckbox) {
    geminiEnableGroundingCheckbox.checked = geminiConfig?.enableGrounding ?? defaults.enableGrounding ?? false;
  }
  if (geminiEnableAffectiveDialogCheckbox) {
    geminiEnableAffectiveDialogCheckbox.checked = geminiConfig?.enableAffectiveDialog ?? defaults.enableAffectiveDialog ?? false;
  }
  if (geminiProactiveAudioCheckbox) {
    geminiProactiveAudioCheckbox.checked = geminiConfig?.proactiveAudio ?? defaults.proactiveAudio ?? false;
  }
  
  // Thinking config
  if (geminiThinkingEnabledCheckbox) {
    geminiThinkingEnabledCheckbox.checked = geminiConfig?.thinkingConfig?.enabled ?? defaults.thinkingConfig?.enabled ?? false;
  }
  if (geminiThinkingBudgetInput) {
    const budget = geminiConfig?.thinkingConfig?.thinkingBudget ?? defaults.thinkingConfig?.thinkingBudget;
    geminiThinkingBudgetInput.value = budget !== null && budget !== undefined ? budget.toString() : '';
  }
  
  // Initial greeting
  if (geminiInitialGreetingEnabledCheckbox) {
    geminiInitialGreetingEnabledCheckbox.checked = geminiConfig?.initialGreeting?.enabled ?? defaults.initialGreeting?.enabled ?? false;
  }
  if (geminiInitialGreetingMessageTextarea) {
    geminiInitialGreetingMessageTextarea.value = geminiConfig?.initialGreeting?.message || defaults.initialGreeting?.message || '';
  }
  
  // VAD config
  const vadDefaults = defaults.vadConfig || {
    disabled: false,
    startOfSpeechSensitivity: 'START_SENSITIVITY_MEDIUM',
    endOfSpeechSensitivity: 'END_SENSITIVITY_MEDIUM',
    prefixPaddingMs: 20,
    silenceDurationMs: 100
  };
  
  if (geminiVadDisabledCheckbox) {
    geminiVadDisabledCheckbox.checked = geminiConfig?.vadConfig?.disabled ?? vadDefaults.disabled ?? false;
  }
  if (geminiVadStartSensitivitySelect) {
    geminiVadStartSensitivitySelect.value = geminiConfig?.vadConfig?.startOfSpeechSensitivity || vadDefaults.startOfSpeechSensitivity || 'START_SENSITIVITY_MEDIUM';
  }
  if (geminiVadEndSensitivitySelect) {
    geminiVadEndSensitivitySelect.value = geminiConfig?.vadConfig?.endOfSpeechSensitivity || vadDefaults.endOfSpeechSensitivity || 'END_SENSITIVITY_MEDIUM';
  }
  if (geminiVadPrefixPaddingInput) {
    geminiVadPrefixPaddingInput.value = (geminiConfig?.vadConfig?.prefixPaddingMs ?? vadDefaults.prefixPaddingMs ?? 20).toString();
  }
  if (geminiVadSilenceDurationInput) {
    geminiVadSilenceDurationInput.value = (geminiConfig?.vadConfig?.silenceDurationMs ?? vadDefaults.silenceDurationMs ?? 100).toString();
  }
}

/**
 * Save Gemini configuration to localStorage
 */
function saveGeminiConfig() {
  if (!geminiConfigStatus) return;
  
  try {
    // Collect values from form
    const geminiConfig: any = {
      apiKey: geminiApiKeyInput?.value.trim() || '',
      model: geminiModelInput?.value.trim() || config.gemini.model || '',
      voiceName: geminiVoiceNameInput?.value.trim() || '',
      languageCode: geminiLanguageCodeInput?.value.trim() || '',
      enableGrounding: geminiEnableGroundingCheckbox?.checked ?? false,
      enableAffectiveDialog: geminiEnableAffectiveDialogCheckbox?.checked ?? false,
      proactiveAudio: geminiProactiveAudioCheckbox?.checked ?? false,
      thinkingConfig: {
        enabled: geminiThinkingEnabledCheckbox?.checked ?? false,
        thinkingBudget: geminiThinkingBudgetInput?.value.trim() ? parseInt(geminiThinkingBudgetInput.value.trim(), 10) : null,
      },
      initialGreeting: {
        enabled: geminiInitialGreetingEnabledCheckbox?.checked ?? false,
        message: geminiInitialGreetingMessageTextarea?.value.trim() || '',
      },
      vadConfig: {
        disabled: geminiVadDisabledCheckbox?.checked ?? false,
        startOfSpeechSensitivity: geminiVadStartSensitivitySelect?.value || 'START_SENSITIVITY_MEDIUM',
        endOfSpeechSensitivity: geminiVadEndSensitivitySelect?.value || 'END_SENSITIVITY_MEDIUM',
        prefixPaddingMs: geminiVadPrefixPaddingInput?.value.trim() ? parseInt(geminiVadPrefixPaddingInput.value.trim(), 10) : 20,
        silenceDurationMs: geminiVadSilenceDurationInput?.value.trim() ? parseInt(geminiVadSilenceDurationInput.value.trim(), 10) : 100,
      }
    };
    
    // Validate API key
    if (!geminiConfig.apiKey) {
      geminiConfigStatus.textContent = '⚠️ API Key is required';
      geminiConfigStatus.className = 'text-sm text-orange-600 mt-2 min-h-[1.2rem]';
      return;
    }
    
    // Save to localStorage
    saveConfigToStorage({ gemini: geminiConfig });
    
    // Reload config to apply changes immediately
    config = loadConfig();
    
    // Show success message
    geminiConfigStatus.textContent = '✅ Configuration saved successfully';
    geminiConfigStatus.className = 'text-sm text-green-600 mt-2 min-h-[1.2rem]';
    
    // Clear success message after 3 seconds
    setTimeout(() => {
      if (geminiConfigStatus) {
        geminiConfigStatus.textContent = '';
        geminiConfigStatus.className = 'text-sm text-gray-600 mt-2 min-h-[1.2rem]';
      }
    }, 3000);
    
  } catch (error) {
    console.error('Error saving Gemini configuration:', error);
    geminiConfigStatus.textContent = '❌ Error saving configuration';
    geminiConfigStatus.className = 'text-sm text-red-600 mt-2 min-h-[1.2rem]';
  }
}

// Initialize Gemini config UI
if (saveGeminiConfigBtn) {
  saveGeminiConfigBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    saveGeminiConfig();
  });
}

if (extractHaConfigBtn) {
  extractHaConfigBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent overlay click handler from firing
    extractHAConfig();
  });
}
