import { LiveServerMessage } from '@google/genai';
import { extractThoughtSignature } from '../utils/thoughtSignatureExtractor';
import { buildFunctionResponse } from '../utils/functionResponseBuilder';
import { createUILogger } from '../utils/uiLogger';
import { MessageHandlerContext } from './messageHandler';

/**
 * Process function calls from Gemini message
 */
export function processFunctionCalls(
  functionCalls: any[],
  msg: LiveServerMessage,
  modelTurn: any,
  ctx: MessageHandlerContext
): void {
  functionCalls.forEach((item: any) => {
    // Handle different function call formats
    const funcCall = item.functionCall || item.function_call || item;
    const name = funcCall?.name || funcCall?.function_name;
    const args = funcCall?.args || funcCall?.arguments;
    
    if (name === 'control_home_assistant' && args) {
      const functionCallId = funcCall?.id;
      
      // Extract thought signature if present (required for function responses according to docs)
      const thoughtSignature = extractThoughtSignature(msg, funcCall, item, modelTurn);
      
      // Check if we've already processed this function call
      if (functionCallId && ctx.processedFunctionCallIds.has(functionCallId)) {
        // Reduced console logging - duplicate detection is working as expected
        // Still send the response back to Gemini (it might be retrying)
        if (ctx.session.value && functionCallId) {
          try {
            const responsePayload = buildFunctionResponse(
              name,
              functionCallId,
              { success: true, note: 'Already executed' },
              thoughtSignature
            );
            // Use sendToolResponse for function responses, not sendRealtimeInput
            // Pass as array even for single response
            (ctx.session.value as any).sendToolResponse({ functionResponses: [responsePayload] });
            // Reduced console logging to prevent audio stutter
          } catch (err) {
            console.error('Error sending duplicate function response:', err);
          }
        }
        return; // Skip execution
      }
      
      // Mark as processed before execution
      if (functionCallId) {
        ctx.processedFunctionCallIds.add(functionCallId);
      }
      
      ctx.executeHAServiceCall(args, ctx.aiFunctionCalls || undefined)
        .then(() => {
          // Send function response back to Gemini with detailed context
          if (ctx.session.value && functionCallId) {
            try {
              // Include detailed response with entity and action info for better AI context
              const entityId = args.target?.entity_id || 'unknown';
              const service = args.service || 'unknown';
              const responseData = {
                success: true,
                entity_id: entityId,
                service: service,
                action: `${service} executed on ${entityId}`,
                message: `Successfully executed ${service} on ${entityId}`
              };
              
              const responsePayload = buildFunctionResponse(
                name,
                functionCallId,
                responseData,
                thoughtSignature
              );
              
              // Log to UI debug panel
              const seq = ++ctx.messageSequence.value;
              const responseTimestamp = new Date().toISOString();
              const logToUI = createUILogger(ctx.aiFunctionCalls || undefined);
              
              logToUI(`\n📤 APP → AI [${responseTimestamp}] [#${seq}]\n`);
              logToUI(`📤 Sending function response: control_home_assistant\n`);
              logToUI(`   Function: ${name}\n`);
              logToUI(`   Call ID: ${functionCallId}\n`);
              logToUI(`   Thought signature: ${thoughtSignature ? 'Found ✅' : 'Not found ⚠️'}\n`);
              logToUI(`   Response structure:\n${JSON.stringify(responsePayload, null, 2)}\n`);
              
              // Log what we received for comparison
              logToUI(`   📥 Received function call structure:\n`);
              logToUI(`      Path: ${item.path || 'unknown'}\n`);
              logToUI(`      Function call keys: ${Object.keys(funcCall || {}).join(', ')}\n`);
              logToUI(`      Full funcCall: ${JSON.stringify(funcCall, null, 2)}\n`);
              
              // Use sendToolResponse for function responses, not sendRealtimeInput
              // The SDK provides sendToolResponse specifically for function responses
              // Pass as array even for single response
              try {
                (ctx.session.value as any).sendToolResponse({ functionResponses: [responsePayload] });
                logToUI(`✅ Function response sent successfully\n`);
              } catch (sendError) {
                console.error('Error in sendToolResponse:', sendError);
                logToUI(`❌ Error sending function response: ${sendError instanceof Error ? sendError.message : String(sendError)}\n`);
                // Don't throw - let the outer catch handle it, but log the specific error
                throw sendError;
              }
            } catch (err) {
              console.error('Error sending function response:', err);
              // Remove from processed set if sending failed, so we can retry
              if (functionCallId) {
                ctx.processedFunctionCallIds.delete(functionCallId);
              }
            }
          }
        })
        .catch(err => {
          console.error('❌ Failed to execute HA service call:', err);
          // Remove from processed set on error, so we can retry
          if (functionCallId) {
            ctx.processedFunctionCallIds.delete(functionCallId);
          }
          // Send error response back to Gemini
          if (ctx.session.value && functionCallId) {
            try {
              const errorPayload = buildFunctionResponse(
                name,
                functionCallId,
                { success: false, error: err.message },
                thoughtSignature
              );
              
              const seq = ++ctx.messageSequence.value;
              const errorResponseTimestamp = new Date().toISOString();
              const logToUIError = createUILogger(ctx.aiFunctionCalls || undefined);
              
              logToUIError(`\n📤 APP → AI [${errorResponseTimestamp}] [#${seq}]\n`);
              logToUIError(`📤 Sending function response: control_home_assistant (ERROR)\n`);
              logToUIError(`   Call ID: ${functionCallId}\n`);
              logToUIError(`   Response: Error - ${err.message}\n`);
              logToUIError(`   Payload:\n${JSON.stringify(errorPayload, null, 2)}\n`);
              
              // Reduced console logging to prevent audio stutter
              // Use sendToolResponse for function responses
              // Pass as array even for single response
              (ctx.session.value as any).sendToolResponse({ functionResponses: [errorPayload] });
            } catch (e) {
              console.error('Error sending error response:', e);
            }
          }
        });
    } else if (name === 'get_home_assistant_state' && args?.entity_id) {
      const functionCallId = funcCall?.id;
      
      // Extract thought signature if present (required for function responses according to docs)
      const thoughtSignature = extractThoughtSignature(msg, funcCall, item, modelTurn);
      
      // Log thought signature detection for debugging
      if (ctx.aiFunctionCalls) {
        const logToUI = createUILogger(ctx.aiFunctionCalls);
        
        if (thoughtSignature) {
          logToUI(`\n🔍 Found thought signature for function call ${functionCallId}\n`);
        } else {
          logToUI(`\n⚠️ No thought signature found for function call ${functionCallId}\n`);
          // Log the full message structure to help debug where thought signatures might be
          logToUI(`   Debug: Checking message structure for thought signatures...\n`);
          logToUI(`   funcCall keys: ${Object.keys(funcCall || {}).join(', ')}\n`);
          logToUI(`   item keys: ${Object.keys(item || {}).join(', ')}\n`);
          logToUI(`   modelTurn exists: ${!!modelTurn}\n`);
          logToUI(`   modelTurn keys: ${modelTurn ? Object.keys(modelTurn).join(', ') : 'N/A'}\n`);
          logToUI(`   msg.serverContent exists: ${!!msg.serverContent}\n`);
          logToUI(`   msg.serverContent.modelTurn exists: ${!!msg.serverContent?.modelTurn}\n`);
          if (msg.serverContent?.modelTurn) {
            const mtKeys = Object.keys(msg.serverContent.modelTurn);
            logToUI(`   msg.serverContent.modelTurn keys: ${mtKeys.join(', ')}\n`);
            if (msg.serverContent.modelTurn.parts) {
              logToUI(`   parts count: ${msg.serverContent.modelTurn.parts.length}\n`);
              msg.serverContent.modelTurn.parts.forEach((part: any, idx: number) => {
                const partKeys = Object.keys(part || {});
                logToUI(`   part[${idx}] keys: ${partKeys.join(', ')}\n`);
                if (part.functionCall || part.function_call) {
                  logToUI(`     functionCall keys: ${Object.keys(part.functionCall || part.function_call || {}).join(', ')}\n`);
                }
                // Check for thought signature in part
                if (part.thoughtSignature || part.thought_signature) {
                  logToUI(`     ⚠️ Found thought signature in part[${idx}]!\n`);
                }
              });
            } else {
              logToUI(`   parts: undefined or null\n`);
            }
          }
          // Also check top-level message structure
          logToUI(`   Top-level msg keys: ${Object.keys(msg || {}).join(', ')}\n`);
          if ((msg as any).thoughtSignature || (msg as any).thought_signature) {
            logToUI(`   ⚠️ Found thought signature at top level!\n`);
          }
          // Check toolCall structure
          if ((msg as any).toolCall) {
            logToUI(`   msg.toolCall keys: ${Object.keys((msg as any).toolCall || {}).join(', ')}\n`);
            if ((msg as any).toolCall.thoughtSignature || (msg as any).toolCall.thought_signature) {
              logToUI(`   ⚠️ Found thought signature in msg.toolCall!\n`);
            }
          }
        }
      }
      
      // Check if we've already processed this function call
      if (functionCallId && ctx.processedFunctionCallIds.has(functionCallId)) {
        // Reduced console logging - duplicate detection is working as expected
        // Still send the response back to Gemini (it might be retrying)
        if (ctx.session.value && functionCallId) {
          try {
            // Re-query the state and send it again
            ctx.getHAEntityState(args.entity_id, ctx.aiFunctionCalls || undefined)
              .then(state => {
                const simplifiedState = {
                  entity_id: state.entity_id,
                  state: state.state,
                  attributes: {
                    friendly_name: state.attributes?.friendly_name,
                    brightness: state.attributes?.brightness,
                    color_temp: state.attributes?.color_temp,
                    color_temp_kelvin: state.attributes?.color_temp_kelvin,
                    temperature: state.attributes?.temperature,
                    current_temperature: state.attributes?.current_temperature,
                    target_temperature: state.attributes?.target_temperature,
                    position: state.attributes?.position,
                    current_position: state.attributes?.current_position
                  }
                };
                
                const responsePayload = buildFunctionResponse(
                  name,
                  functionCallId,
                  simplifiedState,
                  thoughtSignature
                );
                
                // Reduced console logging to prevent audio stutter
                // Use sendToolResponse for function responses
                // Pass as array even for single response
                (ctx.session.value as any).sendToolResponse({ functionResponses: [responsePayload] });
              });
          } catch (err) {
            console.error('Error sending duplicate function response:', err);
          }
        }
        return; // Skip execution
      }
      
      // Mark as processed before execution
      if (functionCallId) {
        ctx.processedFunctionCallIds.add(functionCallId);
      }
      
      // Get the sequence number for the HA request/response pair
      const haSeq = ++ctx.messageSequence.value;
      
      ctx.getHAEntityState(args.entity_id, ctx.aiFunctionCalls || undefined, haSeq)
        .then(state => {
          // State is already logged to UI in the function (HA → APP [#haSeq] is already logged)
          // State retrieved - details logged to UI debug panel
          // Send function response back to Gemini with the state data
          if (ctx.session.value && functionCallId) {
            try {
              // NOTE: Known issue with gemini-2.5-flash-native-audio-preview-09-2025:
              // The preview model may not generate audio responses after receiving function results.
              // This is a known limitation reported by multiple developers.
              // The function response format is correct, but the model may remain silent.
              // See: https://discuss.ai.google.dev/t/inconsistent-response-behavior-in-gemini-2-5-flash-native-audio-preview-09-2025-voicebot/110825
              const responsePayload = buildFunctionResponse(
                name,
                functionCallId,
                {
                  entity_id: state.entity_id,
                  state: state.state,
                  brightness: state.attributes?.brightness,
                  temperature: state.attributes?.temperature || state.attributes?.current_temperature,
                  friendly_name: state.attributes?.friendly_name
                },
                thoughtSignature
              );
              
              // Assign sequence number AFTER HA response is logged (which happens inside getHAEntityState)
              // Since getHAEntityState uses await, it completes before this .then() runs,
              // so the HA response log should already be written
              const seq = ++ctx.messageSequence.value;
              const responseTimestamp = new Date().toISOString();
              const logToUI = createUILogger(ctx.aiFunctionCalls || undefined);
              
              logToUI(`\n📤 APP → AI [${responseTimestamp}] [#${seq}]\n`);
              logToUI(`📤 Sending function response: get_home_assistant_state\n`);
              logToUI(`   Function: ${name}\n`);
              logToUI(`   Call ID: ${functionCallId}\n`);
              logToUI(`   Thought signature: ${thoughtSignature ? 'Found ✅' : 'Not found ⚠️'}\n`);
              if (thoughtSignature) {
                logToUI(`   Thought signature value: ${JSON.stringify(thoughtSignature).substring(0, 100)}...\n`);
              }
              logToUI(`   Response:\n${JSON.stringify(responsePayload, null, 2)}\n`);
              
              // Reduced console logging to prevent audio stutter
              // Function response details are logged to UI debug panel
              try {
                // Check WebSocket connection state before sending
                const sessionAny = ctx.session.value as any;
                const conn = sessionAny?.conn;
                const ws = conn?.ws;
                
                if (ws && ws.readyState !== WebSocket.OPEN) {
                  logToUI(`\n⚠️ WebSocket not open (state: ${ws.readyState}) - cannot send function response\n`);
                  console.error('WebSocket state:', ws.readyState, '(1=OPEN, 3=CLOSED)');
                  return;
                }
                
                logToUI(`\n📤 Sending function response (WebSocket state: ${ws?.readyState || 'unknown'})\n`);
                // Use sendToolResponse for function responses
                // Pass as array even for single response
                sessionAny.sendToolResponse({ functionResponses: [responsePayload] });
                logToUI(`✅ Function response sent successfully\n`);
                
                // Monitor for connection closure after sending
                if (conn && ws) {
                  const originalOnClose = conn.callbacks?.onclose;
                  if (originalOnClose) {
                    const tempOnClose = (event: CloseEvent) => {
                      logToUI(`\n⚠️ Connection closed after sending function response:\n`);
                      logToUI(`   Code: ${event.code}\n`);
                      logToUI(`   Reason: ${event.reason || '(none)'}\n`);
                      logToUI(`   Was clean: ${event.wasClean}\n`);
                      if (event.code === 1000) {
                        logToUI(`   Note: Normal closure (1000) - Gemini may have rejected the response format\n`);
                      }
                      if (originalOnClose) originalOnClose(event);
                    };
                    
                    // Temporarily override to catch closure
                    conn.callbacks.onclose = tempOnClose;
                    
                    // Restore after delay (5 seconds to allow service call to complete)
                    setTimeout(() => {
                      if (conn.callbacks) {
                        conn.callbacks.onclose = originalOnClose;
                      }
                    }, 5000);
                  }
                }
              } catch (err) {
                // Reduced verbose error logging to prevent audio stutter
                console.error('❌ Error sending function response:', err instanceof Error ? err.message : String(err));
                logToUI(`\n❌ Error sending function response: ${err instanceof Error ? err.message : String(err)}\n`);
              }
            } catch (err) {
              // Reduced verbose error logging to prevent audio stutter
              console.error('❌ Error preparing function response:', err instanceof Error ? err.message : String(err));
            }
          } else {
            console.warn('⚠️ Cannot send function response - missing session or functionCallId', {
              hasSession: !!ctx.session.value,
              functionCallId: functionCallId
            });
          }
        })
        .catch(err => {
          console.error('❌ Failed to query HA state:', err);
          // Send error response back to Gemini
          const functionCallId = funcCall?.id;
          if (ctx.session.value && functionCallId) {
            try {
              const errorResponse = buildFunctionResponse(
                name,
                functionCallId,
                { error: err.message },
                thoughtSignature
              );
              // Use sendToolResponse for function responses
              // Pass as array even for single response
              (ctx.session.value as any).sendToolResponse({ functionResponses: [errorResponse] });
            } catch (e) {
              console.error('Error sending error response:', e);
            }
          }
        });
    }
  });
}

