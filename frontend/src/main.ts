import './styles.css';
import { GoogleGenAI, Modality, StartSensitivity, EndSensitivity } from '@google/genai';
import { pcmToGeminiBlob } from './utils/audioUtils';
import { buildSystemInstruction as buildSystemInstructionUtil, buildTools as buildToolsUtil } from './utils/geminiConfigBuilder';
import { executeHAServiceCall as executeHAServiceCallApi, getHAEntityState as getHAEntityStateApi } from './api/haRestApi';
import { createUILogger } from './utils/uiLogger';
import { loadConfig } from './utils/configLoader';
import configData from '../config/config.json';
import { getHAWebSocketUrl } from './utils/haUrlBuilder';
import { updateHAConfigFromTextarea, extractHAConfigFromHomeAssistant } from './utils/haConfigManager';
import { updateUIState, copyToClipboard, updateMuteState } from './utils/uiHelpers';
import { createMessageHandler, MessageHandlerContext } from './handlers/messageHandler';
import { TimeoutManager } from './timeout/timeoutManager';
import { ApplicationState, createInitialState } from './state/applicationState';
import { saveConfigToStorage, loadConfigFromStorage } from './utils/configManager';
import { APP_VERSION } from './utils/version';

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
const installIcon = document.getElementById('install-icon') as HTMLButtonElement | null;
const appVersion = document.getElementById('app-version') as HTMLDivElement | null;
const updatePrompt = document.getElementById('update-prompt') as HTMLDivElement | null;
const updateMessage = document.getElementById('update-message') as HTMLParagraphElement | null;
const updateNowBtn = document.getElementById('update-now-btn') as HTMLButtonElement | null;
const updateLaterBtn = document.getElementById('update-later-btn') as HTMLButtonElement | null;
const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement | null;
const settingsOverlay = document.getElementById('settings-overlay') as HTMLDivElement | null;
const settingsCloseBtn = document.getElementById('settings-close-btn') as HTMLButtonElement | null;
const downloadConfigBtn = document.getElementById('download-config-btn') as HTMLButtonElement | null;
const uploadConfigBtn = document.getElementById('upload-config-btn') as HTMLButtonElement | null;
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
const haEnabledCheckbox = document.getElementById('ha-enabled') as HTMLInputElement | null;
const haBaseUrlInput = document.getElementById('ha-base-url') as HTMLInputElement | null;
const haAccessTokenInput = document.getElementById('ha-access-token') as HTMLInputElement | null;
const haAccessTokenToggle = document.getElementById('ha-access-token-toggle') as HTMLButtonElement | null;
const haTimeoutInput = document.getElementById('ha-timeout') as HTMLInputElement | null;
const haWebSocketTimeoutInput = document.getElementById('ha-websocket-timeout') as HTMLInputElement | null;
const haDomainsInput = document.getElementById('ha-domains') as HTMLInputElement | null;
const haSystemInstruction = document.getElementById('ha-system-instruction') as HTMLTextAreaElement | null;
const saveHaConfigBtn = document.getElementById('save-ha-config-btn') as HTMLButtonElement | null;
const resetHaInstructionBtn = document.getElementById('reset-ha-instruction-btn') as HTMLButtonElement | null;
const haConfigStatus = document.getElementById('ha-config-status') as HTMLDivElement | null;
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
    loadGeminiSystemInstruction(); // Load general instruction when tab is shown
  } else if (tabName === 'homeassistant' && homeAssistantTab) {
    homeAssistantTab.classList.add('active');
    loadHAConfig(); // Load HA config (enabled state, system instruction) when tab is shown
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
    (config) => { 
      appState.haConfig = config;
      // After successful extraction, populate HA system instruction with default if it's empty
      if (haSystemInstruction && !haSystemInstruction.value.trim()) {
        const defaultInstruction = configData.features?.homeAssistant?.systemInstruction || '';
        haSystemInstruction.value = defaultInstruction;
      }
    }, // Store config only (no states)
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
  
  // Also populate HA system instruction with default if extraction succeeded and field is empty
  if (result && haSystemInstruction && !haSystemInstruction.value.trim()) {
    const defaultInstruction = configData.features?.homeAssistant?.systemInstruction || '';
    haSystemInstruction.value = defaultInstruction;
  }
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

// Display app version - will be updated when service worker version is known
// Initially show APP_VERSION, but will be replaced with actual service worker version
if (appVersion) {
  appVersion.textContent = `v${APP_VERSION}`;
}

// Function to update displayed version
function updateDisplayedVersion(version: string | null) {
  if (appVersion && version) {
    appVersion.textContent = `v${version}`;
  }
}

// PWA Install Prompt Handling
let deferredPrompt: any = null;

// Expose diagnostic function to console for debugging
(window as any).checkPWAInstallability = async () => {
  const check = await checkInstallability();
  const swController = navigator.serviceWorker.controller;
  const swRegistration = registration;
  
  console.log('=== PWA INSTALLABILITY DIAGNOSTICS ===');
  console.log('Browser:', navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.includes('Chrome') ? 'Chrome/Edge' : 'Other');
  console.log('beforeinstallprompt support:', 'onbeforeinstallprompt' in window ? '✅ Yes' : '❌ No (Firefox/Safari use different mechanism)');
  console.log('Installable:', check.installable);
  console.log('Issues:', check.reasons.length > 0 ? check.reasons : 'None');
  console.log('Service Worker Controller:', swController ? '✅ Active' : '❌ Not active');
  console.log('Service Worker Registration:', swRegistration ? '✅ Registered' : '❌ Not registered');
  if (swRegistration) {
    console.log('  - Active:', !!swRegistration.active);
    console.log('  - Installing:', !!swRegistration.installing);
    console.log('  - Waiting:', !!swRegistration.waiting);
    console.log('  - Scope:', swRegistration.scope);
  }
  console.log('Deferred Prompt Available:', deferredPrompt ? '✅ Yes' : '❌ No');
  console.log('Standalone Mode:', isStandalone ? '✅ Yes (already installed)' : '❌ No');
  console.log('HTTPS/Localhost:', (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '✅ Yes' : '❌ No');
  console.log('URL:', window.location.href);
  
  // Check manifest
  try {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      const manifestUrl = (manifestLink as HTMLLinkElement).href;
      const manifestResponse = await fetch(manifestUrl);
      const manifest = await manifestResponse.json();
      console.log('Manifest:', manifest);
      console.log('Manifest Content-Type:', manifestResponse.headers.get('content-type'));
    }
  } catch (e) {
    console.error('Error checking manifest:', e);
  }
  
  console.log('\n💡 If installable but no prompt:');
  console.log('   - Firefox: Use browser menu → Install (beforeinstallprompt not supported)');
  console.log('   - Chrome/Edge: May need to clear site data or use incognito');
  console.log('   - Check DevTools → Application → Manifest for validation errors');
  
  return {
    installable: check.installable,
    reasons: check.reasons,
    swController: !!swController,
    swRegistered: !!swRegistration,
    deferredPrompt: !!deferredPrompt,
    standalone: isStandalone,
    browser: navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.includes('Chrome') ? 'Chrome/Edge' : 'Other'
  };
};

// Listen for the beforeinstallprompt event
// Set up listener immediately (before window.load) to catch early events
// Note: This event may not fire even if the app is installable due to browser heuristics
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the default mini-infobar from appearing
  e.preventDefault();
  // Stash the event so it can be triggered later
  deferredPrompt = e;
  // Show install button when prompt is available
  if (installIcon) {
    installIcon.classList.remove('js-hidden');
    console.log('✅ Install prompt available - install button visible');
  } else {
    console.log('Install icon element not found');
  }
  
  // If we were retrying after reload, show a message
  if (sessionStorage.getItem('retryInstall') === 'true') {
    sessionStorage.removeItem('retryInstall');
    console.log('✅ Install prompt now available after reload');
  }
}, { once: false, passive: false });

// Also listen on document for early events
document.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installIcon) {
    installIcon.classList.remove('js-hidden');
    console.log('✅ Install prompt available (from document listener)');
  }
}, { once: false, passive: false });

// Also check after a delay - sometimes the event fires late
// Keep install button visible even if beforeinstallprompt doesn't fire
// The app may still be installable via manual installation
setTimeout(() => {
  if (!isStandalone && installIcon) {
    // Keep button visible - user can click for manual installation instructions
    // Even if beforeinstallprompt didn't fire, the app might be installable
    if (!deferredPrompt) {
      console.log('ℹ️ beforeinstallprompt event did not fire, but app may still be installable');
      console.log('Install button remains visible - click for installation options');
      console.log('Also check browser address bar for install icon (➕)');
    }
    // Don't hide the button - let user try manual installation
  }
}, 5000);

// Listen for app installed event
window.addEventListener('appinstalled', () => {
  // Hide the install button
  if (installIcon) {
    installIcon.classList.add('js-hidden');
  }
  deferredPrompt = null;
  console.log('PWA installed');
});

// Check if app is already installed (standalone mode)
// Only hide if truly in standalone mode (not just if service worker is registered)
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
    (window.navigator as any).standalone === true;
    
if (isStandalone) {
  // App is already installed, hide install button
  if (installIcon) {
    installIcon.classList.add('js-hidden');
  }
  console.log('PWA already installed (standalone mode) - install button hidden');
} else {
  // Not in standalone mode - show install button by default
  // It will be hidden if beforeinstallprompt doesn't fire and app is not installable
  if (installIcon) {
    installIcon.classList.remove('js-hidden');
    console.log('PWA not installed - install button shown');
  }
}

// Function to check PWA installability
async function checkInstallability(): Promise<{ installable: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  let installable = true;
  
  // Check HTTPS/localhost
  const isHTTPS = window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isHTTPS) {
    installable = false;
    reasons.push(`Not served over HTTPS (required for PWA). Current: ${window.location.protocol}//${window.location.hostname}`);
  }
  
  // Check manifest
  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (!manifestLink) {
    installable = false;
    reasons.push('Manifest link not found in HTML');
  } else {
    try {
      const manifestUrl = (manifestLink as HTMLLinkElement).href;
      console.log('Fetching manifest from:', manifestUrl);
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        installable = false;
        reasons.push(`Manifest not accessible (${response.status} ${response.statusText})`);
      } else {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/manifest+json') && !contentType.includes('application/json')) {
          console.warn('Manifest content-type may be incorrect:', contentType);
        }
        
        const manifest = await response.json();
        console.log('Manifest loaded:', manifest);
        
        // Check for required fields
        if (!manifest.name && !manifest.short_name) {
          installable = false;
          reasons.push('Manifest missing required "name" or "short_name" field');
        }
        
        if (!manifest.start_url) {
          installable = false;
          reasons.push('Manifest missing required "start_url" field');
        }
        
        if (!manifest.display) {
          installable = false;
          reasons.push('Manifest missing required "display" field');
        }
        
        // Check for required icons
        if (!manifest.icons || manifest.icons.length === 0) {
          installable = false;
          reasons.push('No icons defined in manifest');
        } else {
          // Check if icons exist and are accessible
          for (const icon of manifest.icons) {
            try {
              const iconUrl = icon.src.startsWith('/') ? icon.src : new URL(icon.src, window.location.origin).pathname;
              console.log('Checking icon:', iconUrl);
              const iconResponse = await fetch(iconUrl, { method: 'HEAD' });
              if (!iconResponse.ok) {
                installable = false;
                reasons.push(`Icon not found: ${icon.src} (${iconResponse.status})`);
                break;
              }
              // Verify it's actually an image
              const iconContentType = iconResponse.headers.get('content-type');
              if (!iconContentType || !iconContentType.startsWith('image/')) {
                installable = false;
                reasons.push(`Icon has wrong content-type: ${icon.src} (${iconContentType})`);
                break;
              }
            } catch (e) {
              installable = false;
              reasons.push(`Icon not accessible: ${icon.src} (${e})`);
              break;
            }
          }
        }
      }
    } catch (e) {
      installable = false;
      reasons.push(`Error loading manifest: ${e}`);
    }
  }
  
  // Check service worker
  if ('serviceWorker' in navigator) {
    if (!registration) {
      installable = false;
      reasons.push('Service worker not registered');
    } else {
      // Verify service worker is actually controlling the page
      if (!navigator.serviceWorker.controller) {
        installable = false;
        reasons.push('Service worker registered but not controlling the page');
      }
    }
  } else {
    installable = false;
    reasons.push('Service workers not supported in this browser');
  }
  
  // Check if browser supports beforeinstallprompt (Chrome/Edge only)
  if (!('onbeforeinstallprompt' in window) && !(window as any).BeforeInstallPromptEvent) {
    console.log('Note: beforeinstallprompt not supported (Firefox/Safari use different install mechanisms)');
  }
  
  return { installable, reasons };
}

// Handle install button click
if (installIcon) {
  installIcon.addEventListener('click', async () => {
    if (!deferredPrompt) {
      console.log('⚠️ No install prompt available - checking installability...');
      
      // Check installability
      const check = await checkInstallability();
      console.log('Installability check result:', check);
      
      // Build message
      let message = 'Install prompt not available.\n\n';
      
      if (check.reasons.length > 0) {
        message += 'Issues found:\n';
        check.reasons.forEach(reason => {
          message += `• ${reason}\n`;
        });
        message += '\n';
      } else {
        message += 'The app appears to meet PWA requirements, but the browser hasn\'t provided an install prompt.\n\n';
        message += 'This usually means:\n';
        message += '• You previously dismissed the install prompt\n';
        message += '• The browser needs more time to evaluate\n\n';
      }
      
      message += 'To install:\n';
      message += '• Look for the install icon (➕) in your browser\'s address bar\n';
      message += '• Or use browser menu → Install App / Add to Home Screen\n';
      message += '• Or try Chrome/Edge: Menu (⋮) → Install TiddeliHome\n';
      
      // Check if service worker is controlling the page
      const swControlling = navigator.serviceWorker.controller !== null;
      if (!swControlling) {
        message += '\n⚠️ Service worker is not controlling the page yet.\n';
        message += 'This is required for installation. Try reloading the page.';
      }
      
      if (check.reasons.length === 0) {
        // All requirements met but prompt not available - browser likely remembered dismissal
        // Provide options to reset
        const resetChoice = confirm(
          message + 
          '\n\n🔧 RESET OPTIONS:\n\n' +
          'The browser has likely "remembered" that you dismissed the install prompt.\n\n' +
          'Click OK to:\n' +
          '1. Unregister service worker\n' +
          '2. Clear site data\n' +
          '3. Reload page\n\n' +
          'This will reset the install prompt state.\n\n' +
          'Click Cancel to use manual installation instead.'
        );
        
        if (resetChoice) {
          try {
            // Unregister all service workers
            if (registration) {
              const unregistered = await registration.unregister();
              console.log('Service worker unregistered:', unregistered);
            }
            
            // Try to clear site data (may require user permission)
            if ('storage' in navigator && 'estimate' in navigator.storage) {
              try {
                // Clear all caches
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
                console.log('Caches cleared');
              } catch (e) {
                console.log('Could not clear caches:', e);
              }
            }
            
            // Clear session storage
            sessionStorage.clear();
            
            // Show instructions for manual browser data clearing
            alert(
              '⚠️ IMPORTANT: Browser install prompt state cannot be cleared programmatically.\n\n' +
              'To completely reset the install prompt:\n\n' +
              '1. Open DevTools (F12)\n' +
              '2. Go to Application tab\n' +
              '3. Click "Clear storage" in left sidebar\n' +
              '4. Check "Site data" and "Local and session storage"\n' +
              '5. Click "Clear site data"\n' +
              '6. Close DevTools and reload page\n\n' +
              'OR use incognito/private window for fresh install prompt state.\n\n' +
              'The page will reload now, but you may still need to clear browser data manually.'
            );
            
            // Reload after a brief delay
            setTimeout(() => {
              window.location.reload();
            }, 500);
          } catch (error) {
            console.error('Error resetting:', error);
            alert('Error during reset. Please manually:\n1. Open DevTools → Application → Service Workers → Unregister\n2. Clear site data\n3. Reload page');
          }
          return;
        } else {
          // User chose manual installation - show detailed instructions
          alert(
            '📱 MANUAL INSTALLATION:\n\n' +
            'Chrome/Edge:\n' +
            '• Look for install icon (➕) in address bar\n' +
            '• Or: Menu (⋮) → Install TiddeliHome\n' +
            '• Or: Settings → Apps → Install this site as an app\n\n' +
            'Firefox:\n' +
            '• Menu (☰) → Install\n' +
            '• Or: Address bar → Install button\n\n' +
            'Safari (iOS):\n' +
            '• Share button → Add to Home Screen\n\n' +
            '💡 TIP: If no install option appears, try:\n' +
            '• Open this site in an incognito/private window (fresh install prompt state)\n' +
            '• Or manually clear site data: DevTools → Application → Clear storage'
          );
        }
      } else {
        alert(message);
      }
      
      return;
    }

    try {
      // Show the install prompt
      deferredPrompt.prompt();

      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      
      console.log(`User response to install prompt: ${outcome}`);
      
      // Clear the deferredPrompt variable
      deferredPrompt = null;
      
      // Hide the install button only if user accepted (appinstalled event will also hide it)
      if (outcome === 'accepted') {
        installIcon.classList.add('js-hidden');
      }
    } catch (error) {
      console.error('Error showing install prompt:', error);
      alert('Error showing install prompt. Please try using your browser\'s install option (usually in the address bar or menu).');
    }
  });
}

// Service Worker Registration and Update Detection
let registration: ServiceWorkerRegistration | null = null;
let waitingWorker: ServiceWorker | null = null;
let currentSWVersion: string | null = null;
let activeSWVersionBeforeUpdate: string | null = null; // Store active worker version before update
let justUpdated = sessionStorage.getItem('justUpdated') === 'true'; // Flag to prevent update loop
let isCheckingForUpdate = false; // Flag to prevent multiple simultaneous update checks
let updatePromptShown = false; // Flag to prevent showing multiple update prompts
let isRegistering = false; // Flag to prevent multiple simultaneous registration attempts

// Function to set up service worker after successful registration
async function setupServiceWorker() {
  if (!registration) return;
  
  console.log('Service Worker registered successfully:', registration.scope);
  console.log('App version:', APP_VERSION);
  
  // After service worker registration, check install button state
  // The beforeinstallprompt event should fire if the app is installable
  console.log('Install button state after SW registration:', {
    elementExists: !!installIcon,
    isHidden: installIcon?.classList.contains('js-hidden'),
    hasDeferredPrompt: !!deferredPrompt,
    isStandalone: isStandalone,
    serviceWorkerRegistered: !!registration
  });
  
  // Note: The beforeinstallprompt event may fire immediately or after a delay
  // It may also not fire if the user previously dismissed the install prompt
  // The install button will appear automatically when the event fires
  
  // Check if service worker is controlling the page
  // This is required for beforeinstallprompt to fire
  if (navigator.serviceWorker.controller) {
    console.log('✅ Service worker is controlling the page - install prompt should be available');
    
    // Additional check: verify manifest is valid
    setTimeout(async () => {
      try {
        const manifestLink = document.querySelector('link[rel="manifest"]');
        if (manifestLink) {
          const manifestUrl = (manifestLink as HTMLLinkElement).href;
          const response = await fetch(manifestUrl);
          const manifest = await response.json();
          const contentType = response.headers.get('content-type');
          
          console.log('Manifest validation:');
          console.log('  - URL:', manifestUrl);
          console.log('  - Content-Type:', contentType);
          console.log('  - Has name:', !!manifest.name);
          console.log('  - Has icons:', !!manifest.icons && manifest.icons.length > 0);
          console.log('  - Has start_url:', !!manifest.start_url);
          console.log('  - Has display:', !!manifest.display);
          
          // Check DevTools Application tab for errors
          console.log('\n⚠️ If beforeinstallprompt still not firing:');
          console.log('   1. Open DevTools → Application → Manifest');
          console.log('   2. Check for validation errors');
          console.log('   3. Verify icons are accessible');
          console.log('   4. Check if browser shows install icon in address bar');
        }
      } catch (e) {
        console.error('Error checking manifest:', e);
      }
    }, 2000);
  } else {
    console.log('⚠️ Service worker is not controlling the page yet - waiting for activation...');
    
    // If there's a waiting or installing worker, it might be stuck
    if (registration.waiting) {
      console.log('Found waiting service worker - activating it for PWA installability');
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else if (registration.installing) {
      console.log('Service worker is installing - will activate when ready');
      registration.installing.addEventListener('statechange', () => {
        if (registration.installing?.state === 'installed' && !navigator.serviceWorker.controller) {
          console.log('Service worker installed but not active - activating...');
          registration.installing.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    } else if (registration.active && !navigator.serviceWorker.controller) {
      // Service worker is active but not controlling - this shouldn't happen
      // Try to reload to get it to control
      console.log('Service worker is active but not controlling page - may need reload');
    }
    
    // Listen for controller change
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('✅ Service worker now controlling the page');
      // The beforeinstallprompt event should fire now
      // Give it a moment to fire before considering a reload
      setTimeout(() => {
        if (!deferredPrompt && !isStandalone) {
          console.log('Service worker is controlling but beforeinstallprompt not fired yet');
          console.log('This may be normal - the browser may need more time or the prompt was previously dismissed');
        }
      }, 2000);
    });
  }
  
  // Check again after a delay in case the event fires late
  setTimeout(() => {
    if (!isStandalone && !deferredPrompt && installIcon) {
      console.log('beforeinstallprompt event still not fired after delay');
      console.log('This is normal if:');
      console.log('  - User previously dismissed the install prompt');
      console.log('  - Browser is still checking installability');
      console.log('  - App does not meet all installability criteria');
      console.log('Service worker controller:', navigator.serviceWorker.controller ? 'Active' : 'Not active');
    } else if (deferredPrompt && installIcon) {
      console.log('Install button should be visible now');
    }
  }, 3000);
  
  /**
   * Check for service worker update and show prompt if available
   */
  async function checkForUpdateAndPrompt() {
    // Don't check if we just updated (to prevent loop)
    if (justUpdated) {
      console.log('Skipping update check - just updated');
      return;
    }
    
    // Don't check if already checking (to prevent multiple simultaneous checks)
    if (isCheckingForUpdate) {
      console.log('Update check already in progress, skipping');
      return;
    }
    
    if (!registration) {
      console.log('No registration available');
      return;
    }
    
    isCheckingForUpdate = true;
    
    try {
      console.log('Checking for service worker update...');
      console.log('Current registration state:', {
        active: !!registration.active,
        installing: !!registration.installing,
        waiting: !!registration.waiting,
        controller: !!navigator.serviceWorker.controller
      });
      
      await registration.update();
      
      // Check if there's a waiting worker
      if (registration.waiting) {
        console.log('Found waiting service worker, showing update prompt');
        // Store the active worker's version before showing the prompt
        // This ensures we show the old version, not the new one
        if (!activeSWVersionBeforeUpdate && currentSWVersion) {
          activeSWVersionBeforeUpdate = currentSWVersion;
          console.log('Stored active worker version before update:', activeSWVersionBeforeUpdate);
        }
        // If we don't have a version yet, wait a moment for it to be retrieved
        if (!currentSWVersion && registration.active) {
          console.log('Waiting for service worker version before showing prompt...');
          // Request version from active worker
          const messageChannel = new MessageChannel();
          messageChannel.port1.onmessage = (event) => {
            if (event.data && event.data.type === 'SW_VERSION') {
              currentSWVersion = event.data.version;
              if (!activeSWVersionBeforeUpdate) {
                activeSWVersionBeforeUpdate = currentSWVersion;
              }
              updateDisplayedVersion(currentSWVersion);
              waitingWorker = registration.waiting;
              isCheckingForUpdate = false;
              showUpdatePrompt();
            }
          };
          registration.active.postMessage({ type: 'GET_VERSION' }, [messageChannel.port2]);
          return;
        }
        waitingWorker = registration.waiting;
        isCheckingForUpdate = false;
        showUpdatePrompt();
        return;
      }
      
      // If no waiting worker, check if one is installing
      if (registration.installing) {
        console.log('Service worker is installing, will show prompt when ready');
        isCheckingForUpdate = false;
        // The updatefound event will handle it
        return;
      }
      
      // If version mismatch but no waiting/installing worker, 
      // the browser might not have fetched the new file yet
      // Force fetch the service worker file to trigger update detection
      console.log('Version mismatch but no waiting worker - forcing service worker file fetch');
      
      // Fetch the service worker file with cache busting to force browser to check
      fetch('/service-worker.js?v=' + APP_VERSION + '&t=' + Date.now(), { 
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      }).then(async () => {
        console.log('Service worker file fetched, checking for update again...');
        // Wait a moment for browser to process, then check again
        await new Promise(resolve => setTimeout(resolve, 500));
        await registration.update();
        
        // Check multiple times as the update might take a moment
        let attempts = 0;
        const checkInterval = setInterval(async () => {
          attempts++;
          await registration.update();
          
          if (registration.waiting) {
            console.log('Found waiting worker after forced fetch');
            clearInterval(checkInterval);
            waitingWorker = registration.waiting;
            isCheckingForUpdate = false;
            showUpdatePrompt();
          } else if (registration.installing) {
            console.log('Service worker is installing after forced fetch');
            clearInterval(checkInterval);
            isCheckingForUpdate = false;
            // Will be handled by updatefound event
          } else if (attempts >= 5) {
            console.log('No update detected after multiple attempts - versions may already match or service worker file is cached');
            clearInterval(checkInterval);
            isCheckingForUpdate = false;
            // Don't show prompt if there's no actual waiting worker
            // The versions might already match, or the browser hasn't detected the change yet
            console.log('Not showing update prompt - no waiting worker found');
          }
        }, 1000);
      }).catch(err => {
        console.error('Error fetching service worker file:', err);
        isCheckingForUpdate = false;
      });
      
    } catch (error) {
      console.error('Error checking for updates:', error);
      isCheckingForUpdate = false;
    }
  }
  
  // Get current service worker version if available
  // IMPORTANT: Only get version from ACTIVE worker, never from waiting worker
  if (registration.active) {
    // Double-check: if there's a waiting worker, make sure we're not reading from it
    if (registration.waiting) {
      console.log('⚠️ Waiting worker exists - only reading version from active worker');
    }
    
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => {
      if (event.data && event.data.type === 'SW_VERSION') {
        // This message came from the active worker via MessageChannel, so it's safe to trust
        const receivedVersion = event.data.version;
        
        // Only update if this is from the active worker (which it should be via MessageChannel)
        // But double-check that we're not in a state where the waiting worker might have activated
        if (!registration.waiting || receivedVersion === currentSWVersion) {
          currentSWVersion = receivedVersion;
          console.log('Service Worker version (from active via MessageChannel):', currentSWVersion);
          console.log('App version:', APP_VERSION);
          
          // Update displayed version to match active service worker
          updateDisplayedVersion(currentSWVersion);
          
          // Compare versions
          if (currentSWVersion && currentSWVersion !== APP_VERSION) {
            console.log('⚠️ Version mismatch detected! SW:', currentSWVersion, 'App:', APP_VERSION);
            // Only check for update if we haven't just updated
            if (!justUpdated) {
              checkForUpdateAndPrompt();
            } else {
              console.log('Skipping update check - just updated (version check on load)');
            }
          } else if (currentSWVersion === APP_VERSION) {
            console.log('✅ Versions match:', currentSWVersion);
            // Clear the justUpdated flag once versions match
            if (justUpdated) {
              sessionStorage.removeItem('justUpdated');
              sessionStorage.removeItem('justUpdatedTimestamp');
              justUpdated = false;
              console.log('Update confirmed - versions match, cleared justUpdated flag');
            }
          }
        } else {
          console.log('⚠️ Version received but waiting worker exists - ignoring to prevent premature update');
        }
      }
    };
    registration.active.postMessage({ type: 'GET_VERSION' }, [messageChannel.port2]);
  }
  
  // Listen for messages from service worker
  // IMPORTANT: Only update version from explicit requests to the ACTIVE service worker
  // Ignore unsolicited version broadcasts, especially from waiting workers
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_VERSION') {
      // Only accept version if:
      // 1. There's no waiting worker (so this must be from active)
      // 2. OR the message came through a MessageChannel port (explicit request)
      // Ignore all broadcast messages when there's a waiting worker
      if (registration && registration.active) {
        // If there's a waiting worker, ignore all unsolicited version messages
        // We only trust versions from explicit MessageChannel requests
        if (registration.waiting) {
          console.log('Service Worker version received (ignoring - waiting worker exists):', event.data.version);
          console.log('Only accepting version from explicit MessageChannel requests');
          return; // Ignore this message
        }
        
        // No waiting worker, so this must be from the active worker
        // But still be cautious - only update if we don't have a version yet or it matches what we expect
        const receivedVersion = event.data.version;
        if (!currentSWVersion || receivedVersion === currentSWVersion || receivedVersion === APP_VERSION) {
          currentSWVersion = receivedVersion;
          console.log('Service Worker version received (from active):', currentSWVersion);
          
          // Update displayed version to match active service worker
          updateDisplayedVersion(currentSWVersion);
          
          // Check for version mismatch and show prompt if needed
          if (currentSWVersion && currentSWVersion !== APP_VERSION) {
            console.log('⚠️ Version mismatch detected! SW:', currentSWVersion, 'App:', APP_VERSION);
            
            // Check if we just updated
            const flagTimestamp = sessionStorage.getItem('justUpdatedTimestamp');
            const timeSinceUpdate = flagTimestamp ? Date.now() - parseInt(flagTimestamp) : Infinity;
            
            // Clear flag if it's been more than 10 seconds since update
            if (justUpdated && timeSinceUpdate > 10000) {
              console.log('Clearing justUpdated flag - enough time has passed since update');
              sessionStorage.removeItem('justUpdated');
              sessionStorage.removeItem('justUpdatedTimestamp');
              justUpdated = false;
            }
            
            // Only check for update if we haven't just updated (or flag was cleared)
            if (!justUpdated) {
              checkForUpdateAndPrompt();
            } else {
              console.log('Skipping update check - just updated (service worker message)');
              console.log('Time since update:', timeSinceUpdate, 'ms');
            }
          } else if (currentSWVersion === APP_VERSION) {
            console.log('✅ Versions match:', currentSWVersion);
            // Clear the justUpdated flag once versions match
            if (justUpdated) {
              sessionStorage.removeItem('justUpdated');
              sessionStorage.removeItem('justUpdatedTimestamp');
              justUpdated = false;
              console.log('Update confirmed - versions match, cleared justUpdated flag');
            }
          }
        } else {
          console.log('Service Worker version received but ignored (unexpected version):', receivedVersion, 'current:', currentSWVersion);
        }
      }
    }
  });
  
  // IMPORTANT: Set up updatefound listener BEFORE calling registration.update()
  // This ensures we catch the event when a new service worker is detected
  registration.addEventListener('updatefound', () => {
    console.log('Service Worker update found!');
    const newWorker = registration!.installing;
    if (newWorker) {
      console.log('New service worker state:', newWorker.state);
      
      // Show prompt as soon as we detect an update is being installed
      // Don't wait for it to reach 'installed' state
      if (navigator.serviceWorker.controller) {
        // There's already a service worker, so this is an update
        console.log('New service worker detected, will show prompt when ready');
        waitingWorker = newWorker;
      }
      
      newWorker.addEventListener('statechange', () => {
        console.log('Service Worker state changed to:', newWorker.state);
        if (newWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // New service worker is available and waiting
            console.log('New service worker installed and waiting, showing update prompt');
            // Store the active worker's version before showing the prompt
            // This ensures we show the old version, not the new one
            if (!activeSWVersionBeforeUpdate && currentSWVersion) {
              activeSWVersionBeforeUpdate = currentSWVersion;
              console.log('Stored active worker version before update:', activeSWVersionBeforeUpdate);
            }
            waitingWorker = newWorker;
            isCheckingForUpdate = false; // Clear flag when showing prompt
            // Only show prompt if we haven't just updated and prompt isn't already shown
            if (!justUpdated && !updatePromptShown) {
              // If we don't have version yet, wait a moment
              if (!currentSWVersion && registration.active) {
                console.log('Waiting for service worker version from updatefound event...');
                setTimeout(() => {
                  if (!updatePromptShown) {
                    showUpdatePrompt();
                  }
                }, 500);
              } else {
                showUpdatePrompt();
              }
            } else {
              console.log('Skipping prompt - just updated or already shown');
            }
          } else {
            // First time installation
            console.log('Service Worker installed for the first time');
          }
        } else if (newWorker.state === 'activating') {
          console.log('Service worker is activating...');
          if (navigator.serviceWorker.controller) {
            // There's an active worker, so this new one shouldn't be activating yet
            console.log('⚠️ Service worker is activating while another is active - this should not happen!');
            if (waitingWorker === newWorker) {
              console.log('⚠️ Service worker activated without user confirmation!');
              waitingWorker = null;
              isCheckingForUpdate = false;
              // Set flag to prevent version check from running
              sessionStorage.setItem('justUpdated', 'true');
              sessionStorage.setItem('justUpdatedTimestamp', Date.now().toString());
              justUpdated = true;
            }
          } else {
            // No active worker, so this is first install - activation is normal
            console.log('Service worker activating (first install - normal)');
          }
        } else if (newWorker.state === 'activated') {
          console.log('Service worker activated');
          if (waitingWorker === newWorker && navigator.serviceWorker.controller) {
            console.log('⚠️ Service worker activated without user confirmation!');
            waitingWorker = null;
            isCheckingForUpdate = false;
            // Set flag to prevent version check from running
            sessionStorage.setItem('justUpdated', 'true');
            sessionStorage.setItem('justUpdatedTimestamp', Date.now().toString());
            justUpdated = true;
          }
        }
      });
    }
  });
  
  // Check for updates immediately - AFTER setting up the listener
  // But only if there's already an active service worker
  // If there's no active worker, the new one will activate immediately (first install)
  if (registration.active) {
    await registration.update();
    
    // Force browser to check for new service worker file (bypass cache)
    // This helps when the service worker file has been updated but browser cached it
    fetch('/service-worker.js?v=' + APP_VERSION + '&t=' + Date.now(), { cache: 'no-store' })
      .then(() => {
        // After fetching, check for update again
        setTimeout(() => registration.update(), 100);
      })
      .catch(() => {}); // Ignore fetch errors
  } else {
    console.log('No active service worker - new installation will activate immediately');
  }
  
  // Also check if there's already a waiting worker (on page load)
  if (registration.waiting) {
    console.log('Service Worker already waiting, showing update prompt');
    // Store the active worker's version before showing the prompt
    // This ensures we show the old version, not the new one
    if (!activeSWVersionBeforeUpdate && currentSWVersion) {
      activeSWVersionBeforeUpdate = currentSWVersion;
      console.log('Stored active worker version before update:', activeSWVersionBeforeUpdate);
    }
    waitingWorker = registration.waiting;
    isCheckingForUpdate = false; // Clear flag when showing prompt
    // Only show prompt if we haven't just updated
    if (!justUpdated) {
      showUpdatePrompt();
    } else {
      console.log('Skipping prompt - just updated (waiting worker check on load)');
    }
  }
  
  // Check for version mismatch on load (in case service worker is already active)
  // Skip this check if we just updated to prevent update loop
  if (!justUpdated) {
    setTimeout(async () => {
      if (registration.active) {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = (event) => {
          if (event.data && event.data.type === 'SW_VERSION') {
            const swVersion = event.data.version;
            if (swVersion && swVersion !== APP_VERSION) {
              console.log('Version mismatch on load - forcing update check');
              checkForUpdateAndPrompt();
            } else {
              console.log('Version match confirmed:', swVersion, '===', APP_VERSION);
            }
          }
        };
        registration.active.postMessage({ type: 'GET_VERSION' }, [messageChannel.port2]);
      }
    }, 1000);
  } else {
    // Don't clear the flag yet - wait until versions match
    console.log('Skipping version check after update to prevent loop');
    
    // Verify the update was successful after a delay
    setTimeout(async () => {
      if (registration.active) {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = (event) => {
          if (event.data && event.data.type === 'SW_VERSION') {
            const swVersion = event.data.version;
            if (swVersion === APP_VERSION) {
              console.log('✅ Update successful - versions match:', swVersion);
              // Clear the justUpdated flag once versions match
              sessionStorage.removeItem('justUpdated');
              sessionStorage.removeItem('justUpdatedTimestamp');
              justUpdated = false;
              console.log('Update confirmed - cleared justUpdated flag');
            } else {
              console.log('⚠️ Version still mismatched after update:', swVersion, '!==', APP_VERSION);
              console.log('Service worker file may not have been updated yet, or browser cached it');
              console.log('The flag will remain set to prevent update loops');
              // Don't clear the flag - keep it set to prevent loops
              // The periodic check will handle it once the new SW file is available
            }
          }
        };
        registration.active.postMessage({ type: 'GET_VERSION' }, [messageChannel.port2]);
      }
    }, 2000);
  }
  
  // Listen for controller change (update activated)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('New service worker activated');
    
    // Only auto-reload if app is installed (standalone mode)
    // When not installed, user is just browsing - don't force reload
    if (isStandalone) {
      console.log('App is installed - reloading page to use new service worker');
      // Set flag to prevent update loop
      sessionStorage.setItem('justUpdated', 'true');
      sessionStorage.setItem('justUpdatedTimestamp', Date.now().toString());
      justUpdated = true;
      isCheckingForUpdate = false;
      updatePromptShown = false; // Reset prompt flag
      // Clear the stored version - after reload, we'll get the new version
      activeSWVersionBeforeUpdate = null;
      // Hide update prompt if still visible
      hideUpdatePrompt();
      // Small delay to ensure state is saved before reload
      setTimeout(() => {
        window.location.reload();
      }, 100);
    } else {
      console.log('App not installed - service worker updated but not reloading (user is browsing)');
      // Just update the flag, don't reload
      justUpdated = true;
      isCheckingForUpdate = false;
      updatePromptShown = false;
      activeSWVersionBeforeUpdate = null;
      hideUpdatePrompt();
    }
  });
  
  // Check for updates on page load (always)
  // This is the standard practice - check once when page loads
  if (registration.active) {
    await registration.update();
  }
  
  // Only check for updates periodically if app is installed
  // When not installed, user is just browsing - don't interrupt with update checks
  if (isStandalone) {
    console.log('App is installed - enabling periodic update checks');
    // Check for updates periodically (every 1 hour for installed apps)
    setInterval(() => {
      if (registration) {
        console.log('Periodic update check (app is installed)...');
        registration.update();
      }
    }, 60 * 60 * 1000); // 1 hour for installed apps
  } else {
    console.log('App not installed - skipping periodic update checks (will check on page load)');
  }
  
  // Also check for updates when app regains focus (if installed)
  if (isStandalone) {
    window.addEventListener('focus', () => {
      if (registration && !isCheckingForUpdate) {
        console.log('App regained focus - checking for updates...');
        registration.update();
      }
    });
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    // Prevent multiple simultaneous registration attempts
    if (isRegistering) {
      console.log('⚠️ Service worker registration already in progress, skipping...');
      return;
    }
    
    // Check for stuck service workers and clean them up first
    try {
      const existingRegs = await navigator.serviceWorker.getRegistrations();
      if (existingRegs.length > 0) {
        console.log(`Found ${existingRegs.length} existing service worker registration(s)`);
        
        // Check if any are stuck in installing state
        const stuckWorkers = existingRegs.filter(reg => {
          const installing = reg.installing;
          const waiting = reg.waiting;
          // Check if installing worker has been stuck for more than 10 seconds
          if (installing && installing.state === 'installing') {
            return true;
          }
          // Check if waiting worker exists (might be stuck)
          if (waiting) {
            return true;
          }
          return false;
        });
        
        if (stuckWorkers.length > 0) {
          console.warn(`Found ${stuckWorkers.length} potentially stuck service worker(s), cleaning up...`);
          // Unregister stuck workers
          for (const reg of stuckWorkers) {
            try {
              await reg.unregister();
              console.log('✅ Unregistered stuck service worker:', reg.scope);
            } catch (unregError) {
              console.warn('Could not unregister service worker:', unregError);
            }
          }
          // Wait a moment after cleanup
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (cleanupError) {
      console.warn('Could not check for existing service workers:', cleanupError);
    }
    
    isRegistering = true;
    
    // PRE-FETCH: On mobile Chrome, we need to pre-fetch the service worker file
    // to ensure the certificate is accepted before attempting registration
    // Regular fetch works, but service worker registration has stricter requirements
    let preFetchSuccessful = false;
    
    try {
      console.log('Pre-fetching service worker file to verify certificate acceptance...');
      const preFetchResponse = await fetch('/service-worker.js', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit' // Don't send cookies
      });
      
      if (preFetchResponse.ok) {
        preFetchSuccessful = true;
        console.log('✅ Service worker file is accessible (status: ' + preFetchResponse.status + ')');
        // Read the response to ensure it's fully loaded
        await preFetchResponse.text();
        console.log('✅ Service worker file content loaded successfully');
      } else {
        console.warn('⚠️ Service worker file returned status: ' + preFetchResponse.status);
      }
    } catch (preFetchError: any) {
      const isCertError = preFetchError?.message?.includes('certificate') || 
                         preFetchError?.message?.includes('SSL') ||
                         preFetchError?.name === 'TypeError' && preFetchError?.message?.includes('Failed to fetch');
      
      if (isCertError) {
        console.warn('⚠️ Certificate not accepted for service worker file');
        console.warn('Please accept the certificate and reload the page');
        // Will fall through to registration attempt which will handle the error
      } else {
        console.warn('Pre-fetch had non-certificate error:', preFetchError?.message);
        // Continue anyway - might still work
      }
    }
    
    // Small delay to ensure certificate state is settled (especially on mobile)
    if (preFetchSuccessful) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    try {
      console.log('Attempting service worker registration...');
      registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
        updateViaCache: 'none' // Always check for updates, don't use cache
      });
      
      console.log('✅ Service worker registration successful!');
      
      // Set up all service worker functionality
      await setupServiceWorker();
      
      isRegistering = false; // Registration successful
      
    } catch (error: any) {
      console.error('Service Worker registration failed:', error);
      
      // Check if it's an SSL certificate error
      const isSSLError = error?.message?.includes('SSL certificate') || 
                        error?.message?.includes('certificate') ||
                        error?.name === 'SecurityError';
      
      if (isSSLError) {
        // Check if regular fetch works but service worker registration doesn't
        // This indicates Chrome on Android's strict service worker certificate policy
        let fetchWorksButSWFails = false;
        try {
          const testFetch = await fetch('/service-worker.js', { method: 'HEAD', cache: 'no-store' });
          if (testFetch.ok) {
            fetchWorksButSWFails = true;
          }
        } catch (e) {
          // Fetch also fails, so it's a general certificate issue
        }
        
        if (fetchWorksButSWFails) {
          console.error('');
          console.error('🚫 CHROME ANDROID SECURITY LIMITATION');
          console.error('═══════════════════════════════════════════════════════');
          console.error('');
          console.error('❌ Regular fetch works (200 OK), but service worker registration fails.');
          console.error('   Chrome on Android blocks self-signed certificates for service workers.');
          console.error('');
          console.error('📱 SOLUTIONS:');
          console.error('');
          console.error('OPTION 1: Install mkcert root CA on your Pixel 7 (RECOMMENDED)');
          console.error('───────────────────────────────────────────────────────');
          console.error('1. On your dev machine, find the mkcert root CA certificate:');
          console.error('   Windows: %USERPROFILE%\\.local\\share\\mkcert\\rootCA.pem');
          console.error('   Or check: %APPDATA%\\mkcert\\ or %LOCALAPPDATA%\\mkcert\\');
          console.error('   Linux/Mac: ~/.local/share/mkcert/rootCA.pem');
          console.error('');
          console.error('2. If not found, run: mkcert -install');
          console.error('   This will show you where the certificate is stored');
          console.error('');
          console.error('3. Transfer rootCA.pem to your Pixel 7 (via USB, email, etc.)');
          console.error('');
          console.error('4. On Pixel 7:');
          console.error('   Settings → Security → Encryption & credentials');
          console.error('   → Install from storage → Select rootCA.pem');
          console.error('   → Name: "Dev Certificate"');
          console.error('   → Credential use: "VPN and apps"');
          console.error('   → Install');
          console.error('');
          console.error('5. Restart Chrome completely (close all tabs, force stop)');
          console.error('');
          console.error('OPTION 2: Use a tunneling service');
          console.error('───────────────────────────────────────────────────────');
          console.error('Use ngrok, localtunnel, or similar to get a valid SSL certificate:');
          console.error('  ngrok http 3000');
          console.error('  (Provides https://xxxxx.ngrok.io with valid certificate)');
          console.error('');
          console.error('OPTION 3: Test on desktop Chrome');
          console.error('───────────────────────────────────────────────────────');
          console.error('Desktop Chrome is more lenient - test PWA features there first.');
          console.error('');
          console.error('⚠️  PWA features (install, offline) will NOT work on mobile');
          console.error('    until the certificate is properly installed.');
          console.error('');
          console.error('═══════════════════════════════════════════════════════');
        } else {
          console.warn('⚠️ SSL Certificate Error detected');
          console.warn('IMPORTANT: On mobile, you need to accept the certificate for the service worker file separately!');
          console.warn('');
          console.warn('📱 MOBILE FIX (Pixel 7 / Chrome):');
          console.warn('1. Copy this URL: ' + window.location.origin + '/service-worker.js');
          console.warn('2. Open it in a NEW TAB in your browser');
          console.warn('3. Accept the certificate warning when it appears');
          console.warn('4. Return to this tab - the service worker will retry automatically');
          console.warn('');
          console.warn('💡 The certificate must be accepted for BOTH:');
          console.warn('   - The main page (you already did this)');
          console.warn('   - The service worker file (do this now)');
        }
        
        // Expose manual retry function to window for debugging
        (window as any).retryServiceWorkerRegistration = async () => {
          try {
            console.log('Manual retry triggered...');
            
            // Step 1: Pre-fetch the service worker file to ensure certificate is accepted
            try {
              console.log('Step 1: Pre-fetching service worker file...');
              const testFetch = await fetch('/service-worker.js', { 
                method: 'GET', 
                cache: 'no-store' 
              });
              const content = await testFetch.text(); // Read the content fully
              console.log('✅ Pre-fetch successful (length:', content.length, 'bytes)');
            } catch (fetchErr: any) {
              console.warn('⚠️ Pre-fetch failed:', fetchErr?.message || fetchErr);
              console.warn('This might indicate the certificate is not fully accepted');
            }
            
            // Step 2: Wait a moment for certificate state to settle
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Step 3: Unregister any existing service workers
            try {
              const existingRegs = await navigator.serviceWorker.getRegistrations();
              if (existingRegs.length > 0) {
                console.log('Step 2: Found', existingRegs.length, 'existing registration(s), unregistering...');
                await Promise.all(existingRegs.map(reg => reg.unregister()));
                console.log('✅ Existing registrations unregistered');
                await new Promise(resolve => setTimeout(resolve, 1000));
              } else {
                console.log('Step 2: No existing registrations found');
              }
            } catch (unregErr: any) {
              console.warn('Could not unregister existing workers:', unregErr?.message || unregErr);
            }
            
            // Step 4: Attempt registration
            console.log('Step 3: Attempting service worker registration...');
            registration = await navigator.serviceWorker.register('/service-worker.js', {
              scope: '/',
              updateViaCache: 'none'
            });
            console.log('✅ Service Worker registered successfully!');
            
            // Step 5: Set up service worker
            await setupServiceWorker();
            console.log('✅ Service worker setup complete!');
          } catch (err: any) {
            console.error('❌ Manual retry failed:', err);
            console.error('Error details:', {
              name: err.name,
              message: err.message,
              stack: err.stack
            });
            
            // Provide specific guidance based on error type
            if (err.name === 'SecurityError' || err.message?.includes('certificate')) {
              console.error('');
              console.error('🔒 SSL Certificate Issue:');
              console.error('On Chrome Android, service worker registration has stricter requirements.');
              console.error('Try:');
              console.error('1. Open this URL directly: ' + window.location.origin + '/service-worker.js');
              console.error('2. Accept the certificate');
              console.error('3. Hard refresh this page (pull down to refresh)');
              console.error('4. Run retryServiceWorkerRegistration() again');
            }
            
            throw err;
          }
        };
        console.log('💡 You can manually retry by calling: retryServiceWorkerRegistration()');
        
        isRegistering = false;
      } else {
        // Other errors - log details
        console.warn('Service Worker registration failed:', error?.message || error);
        console.warn('PWA features (install, offline) will not be available.');
        isRegistering = false;
      }
    }
  });
}

/**
 * Show update prompt to user
 */
function showUpdatePrompt() {
  if (!updatePrompt) return;
  
  // Prevent showing multiple prompts
  if (updatePromptShown) {
    console.log('Update prompt already shown, skipping');
    return;
  }
  
  // Don't show if we just updated
  if (justUpdated) {
    console.log('Skipping update prompt - just updated');
    return;
  }
  
  // Use the stored version from before the update was detected
  // This ensures we always show the old (active) version, not the new (waiting) version
  const versionToShow = activeSWVersionBeforeUpdate || currentSWVersion || 'unknown';
  
  // Update message with version info
  if (updateMessage) {
    updateMessage.textContent = `A new version of TiddeliHome is available (v${APP_VERSION}). Current version: v${versionToShow}. Would you like to update now?`;
  }
  
  updatePromptShown = true;
  updatePrompt.classList.remove('invisible');
  updatePrompt.classList.add('opacity-100');
  updatePrompt.style.pointerEvents = 'auto';
  console.log('Update prompt shown');
}

/**
 * Hide update prompt
 */
function hideUpdatePrompt() {
  if (!updatePrompt) return;
  
  updatePromptShown = false;
  updatePrompt.classList.add('invisible');
  updatePrompt.classList.remove('opacity-100');
  updatePrompt.style.pointerEvents = 'none';
}

// Handle update buttons
if (updateNowBtn) {
  updateNowBtn.addEventListener('click', () => {
    // Set flag to prevent update loop after reload
    sessionStorage.setItem('justUpdated', 'true');
    sessionStorage.setItem('justUpdatedTimestamp', Date.now().toString());
    justUpdated = true;
    isCheckingForUpdate = false; // Prevent any ongoing update checks
    
    if (waitingWorker) {
      // Tell the waiting service worker to skip waiting and activate
      console.log('Sending SKIP_WAITING to waiting service worker');
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      hideUpdatePrompt();
      // Clear waiting worker reference
      waitingWorker = null;
      // The controllerchange event will trigger a reload
    } else if (registration && registration.waiting) {
      // Fallback: if waitingWorker wasn't set but there's a waiting worker
      console.log('Sending SKIP_WAITING to registration.waiting');
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      hideUpdatePrompt();
      waitingWorker = null;
    } else {
      // No waiting worker - just reload to get the new version
      console.log('No waiting worker, reloading page to get new version');
      hideUpdatePrompt();
      window.location.reload();
    }
  });
}

if (updateLaterBtn) {
  updateLaterBtn.addEventListener('click', () => {
    hideUpdatePrompt();
    // User can update later - we'll check again on next page load or periodic check
  });
}

/**
 * Download all configuration as JSON file
 * Includes user overrides, defaults from config.json, and system instructions
 */
function downloadConfig() {
  try {
    // Reload config to get the complete merged configuration
    const fullConfig = loadConfig();
    
    // Create a config object with all settings (excluding runtime state)
    const configToDownload: any = {
      gemini: {
        model: fullConfig.gemini.model,
        apiKey: fullConfig.gemini.apiKey, // User's API key (if set)
        systemInstruction: fullConfig.gemini.systemInstruction, // Full system instruction (template or override)
        enableGrounding: fullConfig.gemini.enableGrounding,
        enableAffectiveDialog: fullConfig.gemini.enableAffectiveDialog,
        voiceName: fullConfig.gemini.voiceName,
        languageCode: fullConfig.gemini.languageCode,
        proactiveAudio: fullConfig.gemini.proactiveAudio,
        audio: fullConfig.gemini.audio,
        thinkingConfig: fullConfig.gemini.thinkingConfig,
        initialGreeting: fullConfig.gemini.initialGreeting,
        vadConfig: fullConfig.gemini.vadConfig
      },
      ui: fullConfig.ui,
      features: {
        homeAssistant: {
          enabled: fullConfig.features.homeAssistant?.enabled,
          baseUrl: fullConfig.features.homeAssistant?.baseUrl, // User's baseUrl (if set)
          accessToken: fullConfig.features.homeAssistant?.accessToken, // User's accessToken (if set)
          timeout: fullConfig.features.homeAssistant?.timeout,
          webSocketConnectionTimeout: fullConfig.features.homeAssistant?.webSocketConnectionTimeout,
          systemInstruction: fullConfig.features.homeAssistant?.systemInstruction, // HA system instruction override (if set)
          functionCalling: fullConfig.features.homeAssistant?.functionCalling
        }
      },
      // Add metadata
      _metadata: {
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        exportedBy: 'TiddeliHome',
        note: 'This configuration includes user overrides and defaults. System instructions are included as full text.'
      }
    };
    
    // Convert to JSON string with indentation
    const jsonString = JSON.stringify(configToDownload, null, 2);
    
    // Create a blob and download link
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tiddelihome-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log('Configuration downloaded successfully');
  } catch (error) {
    console.error('Error downloading configuration:', error);
    alert('Error downloading configuration. Please try again.');
  }
}

/**
 * Upload configuration from JSON file (placeholder for future implementation)
 */
function uploadConfig() {
  alert('Upload configuration functionality will be implemented soon.');
}

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
if (downloadConfigBtn) {
  downloadConfigBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadConfig();
  });
}
if (uploadConfigBtn) {
  uploadConfigBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    uploadConfig();
  });
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
// HA config textarea is read-only, populated only via Extract button
// Event listeners removed since user cannot edit it

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
const geminiSystemInstruction = document.getElementById('gemini-system-instruction') as HTMLTextAreaElement | null;
const resetGeminiInstructionBtn = document.getElementById('reset-gemini-instruction-btn') as HTMLButtonElement | null;
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
    
    // Save general system instruction if it was edited
    if (geminiSystemInstruction) {
      const generalText = geminiSystemInstruction.value.trim();
      
      // Ensure FEATURE_CAPABILITIES placeholder exists (will be replaced during build)
      let fullInstruction = generalText;
      if (!fullInstruction.includes('{FEATURE_CAPABILITIES}')) {
        if (!fullInstruction.endsWith('\n')) {
          fullInstruction += '\n';
        }
        fullInstruction += '{FEATURE_CAPABILITIES}';
      }
      
      // Add system instruction to geminiConfig
      geminiConfig.systemInstruction = fullInstruction;
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

/**
 * Load general system instruction into the textarea
 * Shows user override if exists, otherwise shows default from config.json
 */
function loadGeminiSystemInstruction() {
  if (!geminiSystemInstruction) return;
  
  // Get user override from config, or use default from config.json
  const instruction = config.gemini?.systemInstruction || configData.gemini?.systemInstruction || '';
  geminiSystemInstruction.value = instruction;
}

/**
 * Reset general system instruction to default (clear user override)
 */
function resetGeminiSystemInstruction() {
  if (!geminiSystemInstruction) return;
  
  try {
    // Use default from config.json
    const defaultGeneral = configData.gemini?.systemInstruction || '';
    geminiSystemInstruction.value = defaultGeneral;
    
  } catch (error) {
    console.error('Error resetting general system instruction:', error);
  }
}

/**
 * Load all HA configuration fields into the UI
 * Shows user overrides if exist, otherwise shows defaults from config.json or environment
 */
function loadHAConfig() {
  const haConfig = config.features?.homeAssistant || {};
  const defaultConfig = configData.features?.homeAssistant || {};
  
  // Load enabled checkbox
  if (haEnabledCheckbox) {
    haEnabledCheckbox.checked = haConfig.enabled !== false; // Default to true if not set
  }
  
  // Load baseUrl (from config or env, with config taking priority)
  if (haBaseUrlInput) {
    haBaseUrlInput.value = haConfig.baseUrl || import.meta.env.VITE_HA_BASE_URL || defaultConfig.baseUrl || '';
  }
  
  // Load accessToken (from config or env, with config taking priority)
  if (haAccessTokenInput) {
    haAccessTokenInput.value = haConfig.accessToken || import.meta.env.VITE_HA_ACCESS_TOKEN || defaultConfig.accessToken || '';
  }
  
  // Load timeout
  if (haTimeoutInput) {
    haTimeoutInput.value = (haConfig.timeout || defaultConfig.timeout || 30000).toString();
  }
  
  // Load WebSocket timeout
  if (haWebSocketTimeoutInput) {
    haWebSocketTimeoutInput.value = (haConfig.webSocketConnectionTimeout || defaultConfig.webSocketConnectionTimeout || 5000).toString();
  }
  
  // Load domains (convert array to comma-separated string)
  if (haDomainsInput) {
    const domains = haConfig.functionCalling?.domains || defaultConfig.functionCalling?.domains || [];
    haDomainsInput.value = Array.isArray(domains) ? domains.join(', ') : domains;
  }
  
  // Load system instruction
  if (haSystemInstruction) {
    const instruction = haConfig.systemInstruction || defaultConfig.systemInstruction || '';
    haSystemInstruction.value = instruction;
  }
}

/**
 * Load HA system instruction into the textarea
 * Shows user override if exists, otherwise shows default from config.json
 * @deprecated Use loadHAConfig() instead
 */
function loadHASystemInstruction() {
  loadHAConfig();
}

/**
 * Save all HA configuration to localStorage
 */
function saveHAConfig() {
  if (!haConfigStatus) return;
  
  try {
    const enabled = haEnabledCheckbox?.checked ?? true;
    const baseUrl = haBaseUrlInput?.value.trim() || '';
    const accessToken = haAccessTokenInput?.value.trim() || '';
    const timeout = haTimeoutInput?.value.trim() ? parseInt(haTimeoutInput.value.trim(), 10) : undefined;
    const webSocketTimeout = haWebSocketTimeoutInput?.value.trim() ? parseInt(haWebSocketTimeoutInput.value.trim(), 10) : undefined;
    const domainsStr = haDomainsInput?.value.trim() || '';
    const instructionText = haSystemInstruction?.value.trim() || '';
    
    // Parse domains from comma-separated string
    const domains = domainsStr ? domainsStr.split(',').map(d => d.trim()).filter(d => d.length > 0) : undefined;
    
    // Build HA config object (only include fields that have values)
    const haConfig: any = {
      enabled: enabled
    };
    
    // Only save baseUrl if provided (don't override env var if empty)
    if (baseUrl) {
      haConfig.baseUrl = baseUrl;
    }
    
    // Only save accessToken if provided (don't override env var if empty)
    if (accessToken) {
      haConfig.accessToken = accessToken;
    }
    
    // Save timeouts if provided
    if (timeout) {
      haConfig.timeout = timeout;
    }
    
    if (webSocketTimeout) {
      haConfig.webSocketConnectionTimeout = webSocketTimeout;
    }
    
    // Save function calling config if domains provided
    if (domains && domains.length > 0) {
      haConfig.functionCalling = {
        domains: domains
      };
    }
    
    // Save system instruction (empty string means use default)
    haConfig.systemInstruction = instructionText || undefined;
    
    // Save to localStorage
    saveConfigToStorage({
      features: {
        homeAssistant: haConfig
      }
    });
    
    // Reload config to apply changes immediately
    config = loadConfig();
    
    // Show success message
    haConfigStatus.textContent = '✅ HA configuration saved successfully';
    haConfigStatus.className = 'text-sm text-green-600 mt-2 min-h-[1.2rem]';
    
    // Clear success message after 3 seconds
    setTimeout(() => {
      if (haConfigStatus) {
        haConfigStatus.textContent = '';
        haConfigStatus.className = 'text-sm text-gray-600 mt-2 min-h-[1.2rem]';
      }
    }, 3000);
    
  } catch (error) {
    console.error('Error saving HA configuration:', error);
    if (haConfigStatus) {
      haConfigStatus.textContent = '❌ Error saving configuration';
      haConfigStatus.className = 'text-sm text-red-600 mt-2 min-h-[1.2rem]';
    }
  }
}

/**
 * Save HA system instruction and enabled state to localStorage
 * @deprecated Use saveHAConfig() instead
 */
function saveHASystemInstruction() {
  saveHAConfig();
}

/**
 * Reset HA system instruction to default (clear user override)
 */
function resetHASystemInstruction() {
  if (!haSystemInstruction || !haConfigStatus) return;
  
  try {
    // Use default from config.json
    const defaultInstruction = configData.features?.homeAssistant?.systemInstruction || '';
    haSystemInstruction.value = defaultInstruction;
    
    // Remove override from localStorage by loading existing config, deleting the property, and saving
    const existingConfig = loadConfigFromStorage() || {};
    if (existingConfig.features?.homeAssistant?.systemInstruction !== undefined) {
      const haConfig = { ...existingConfig.features?.homeAssistant };
      delete haConfig.systemInstruction;
      saveConfigToStorage({
        features: {
          homeAssistant: haConfig
        }
      });
    }
    
    // Reload config to apply changes immediately
    config = loadConfig();
    
    // Reload all HA config fields to reflect the change
    loadHAConfig();
    
    // Show success message
    haConfigStatus.textContent = '✅ Reset to default successfully';
    haConfigStatus.className = 'text-sm text-green-600 mt-2 min-h-[1.2rem]';
    
    // Clear success message after 3 seconds
    setTimeout(() => {
      if (haConfigStatus) {
        haConfigStatus.textContent = '';
        haConfigStatus.className = 'text-sm text-gray-600 mt-2 min-h-[1.2rem]';
      }
    }, 3000);
    
  } catch (error) {
    console.error('Error resetting HA system instruction:', error);
    if (haConfigStatus) {
      haConfigStatus.textContent = '❌ Error resetting instruction';
      haConfigStatus.className = 'text-sm text-red-600 mt-2 min-h-[1.2rem]';
    }
  }
}

// Initialize HA configuration UI
if (saveHaConfigBtn) {
  saveHaConfigBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    saveHAConfig();
  });
}

// Toggle access token visibility
if (haAccessTokenToggle && haAccessTokenInput) {
  haAccessTokenToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isPassword = haAccessTokenInput.type === 'password';
    haAccessTokenInput.type = isPassword ? 'text' : 'password';
    haAccessTokenToggle.textContent = isPassword ? '🙈' : '👁️';
  });
}
if (resetHaInstructionBtn) {
  resetHaInstructionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetHASystemInstruction();
  });
}

if (extractHaConfigBtn) {
  extractHaConfigBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent overlay click handler from firing
    extractHAConfig();
  });
}

