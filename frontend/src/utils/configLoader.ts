/**
 * Configuration loading utilities
 * Handles loading and merging configuration from multiple sources
 */

import configData from '../../config/config.json';
// @ts-ignore - Vite handles ?raw imports at build time
import systemInstructionTemplate from '../../config/system-instruction.txt?raw';

/**
 * Application configuration type
 */
export interface AppConfig {
  gemini: {
    model: string;
    apiKey: string;
    systemInstruction: string;
    enableGrounding?: boolean;
    enableAffectiveDialog?: boolean;
    voiceName?: string;
    languageCode?: string;
    proactiveAudio?: boolean;
    audio?: {
      outputSampleRate: number;
    };
    thinkingConfig?: {
      enabled?: boolean;
      thinkingBudget?: number;
      includeThoughts?: boolean;
    };
    initialGreeting?: {
      enabled?: boolean;
      message?: string;
    };
    vadConfig?: {
      disabled?: boolean;
      startOfSpeechSensitivity?: string;
      endOfSpeechSensitivity?: string;
      prefixPaddingMs?: number;
      silenceDurationMs?: number;
    };
  };
  // Backward compatibility: expose audio at top level (computed from gemini.audio)
  audio: {
    outputSampleRate: number;
  };
  ui?: {
    feedbackDuration?: number;
    autoDisconnectDelay?: number;
    connectionMonitorRestoreDelay?: number;
    noActionTimeout?: number;
  };
  features: {
    homeAssistant?: {
      enabled?: boolean;
      baseUrl: string;
      accessToken: string;
      timeout: number;
      webSocketConnectionTimeout?: number;
      systemInstruction?: string;
      functionCalling?: {
        domains?: string[];
        serviceDataProperties?: Record<string, any>;
        allowAnyDomain?: boolean;
        allowAnyServiceData?: boolean;
      };
    };
  };
  // Backward compatibility properties (computed from features.homeAssistant)
  homeAssistant: {
    baseUrl: string;
    accessToken: string;
    timeout: number;
    webSocketConnectionTimeout?: number;
  };
  functionCalling: {
    domains?: string[];
    serviceDataProperties?: Record<string, any>;
    allowAnyDomain?: boolean;
    allowAnyServiceData?: boolean;
  };
}

/**
 * Load and merge config with environment variables or user settings
 * Priority: user settings (localStorage) > environment variables > config.json defaults > text file template
 * @returns Merged configuration object
 */
export function loadConfig(): AppConfig {
  // Try to load user settings from localStorage first
  const userConfigStr = localStorage.getItem('tiddelihome_config');
  const userConfig = userConfigStr ? JSON.parse(userConfigStr) : null;
  
  // Debug: Log what we're loading
  if (userConfig) {
    const haConfigSource = userConfig.features?.homeAssistant || userConfig.homeAssistant;
    console.log('Loading config from localStorage:', {
      hasBaseUrl: !!haConfigSource?.baseUrl,
      baseUrl: haConfigSource?.baseUrl,
      hasAccessToken: !!haConfigSource?.accessToken,
      accessTokenLength: haConfigSource?.accessToken?.length || 0
    });
  } else {
    console.log('No localStorage config found, using defaults');
  }
  
  // Debug: Log what we're getting from each source
  const configJsonHA = configData.features?.homeAssistant || configData.homeAssistant;
  console.log('Config sources:', {
    fromLocalStorage: userConfig?.features?.homeAssistant || userConfig?.homeAssistant,
    fromEnv: {
      hasBaseUrl: !!import.meta.env.VITE_HA_BASE_URL,
      baseUrl: import.meta.env.VITE_HA_BASE_URL ? '***' : undefined, // Don't log actual URL
      hasAccessToken: !!import.meta.env.VITE_HA_ACCESS_TOKEN
    },
    fromConfigJson: configJsonHA
  });
  
  // Get system instruction: user config > text file template
  const systemInstruction = userConfig?.gemini?.systemInstruction || systemInstructionTemplate;
  
  // Helper function to get HA config from new structure or old structure (backward compatibility)
  const getHAConfig = () => {
    // Try new structure first (features.homeAssistant) - from userConfig or configData
    const newHAConfig = userConfig?.features?.homeAssistant || configData.features?.homeAssistant;
    if (newHAConfig) {
      return {
        enabled: newHAConfig.enabled !== undefined ? newHAConfig.enabled : true,
        baseUrl: (newHAConfig.baseUrl || 
                 import.meta.env.VITE_HA_BASE_URL || '').trim(),
        accessToken: (newHAConfig.accessToken || 
                     import.meta.env.VITE_HA_ACCESS_TOKEN || '').trim(),
        timeout: newHAConfig.timeout || 30000,
        webSocketConnectionTimeout: newHAConfig.webSocketConnectionTimeout || 5000,
        functionCalling: newHAConfig.functionCalling || {
          domains: ['light', 'scene', 'script'],
          serviceDataProperties: {
            brightness: {
              type: 'number',
              description: 'Brightness level for lights (0-255)'
            },
            color_name: {
              type: 'string',
              description: 'Color name for lights (e.g., "red", "blue", "warm")'
            }
          },
          allowAnyDomain: false,
          allowAnyServiceData: true
        }
      };
    }
    // Fall back to old structure for backward compatibility (only from userConfig, not configData)
    const oldHAConfig = userConfig?.homeAssistant;
    const oldFunctionCalling = userConfig?.functionCalling;
    if (oldHAConfig || oldFunctionCalling) {
      return {
        enabled: true,
        baseUrl: (oldHAConfig?.baseUrl || 
                 import.meta.env.VITE_HA_BASE_URL || '').trim(),
        accessToken: (oldHAConfig?.accessToken || 
                     import.meta.env.VITE_HA_ACCESS_TOKEN || '').trim(),
        timeout: oldHAConfig?.timeout || 30000,
        webSocketConnectionTimeout: oldHAConfig?.webSocketConnectionTimeout || 5000,
        functionCalling: oldFunctionCalling || {
          domains: ['light', 'scene', 'script'],
          serviceDataProperties: {
            brightness: {
              type: 'number',
              description: 'Brightness level for lights (0-255)'
            },
            color_name: {
              type: 'string',
              description: 'Color name for lights (e.g., "red", "blue", "warm")'
            }
          },
          allowAnyDomain: false,
          allowAnyServiceData: true
        }
      };
    }
    // Default fallback (shouldn't normally happen since config.json has the new structure)
    return {
      enabled: true,
      baseUrl: (import.meta.env.VITE_HA_BASE_URL || '').trim(),
      accessToken: (import.meta.env.VITE_HA_ACCESS_TOKEN || '').trim(),
      timeout: 30000,
      webSocketConnectionTimeout: 5000,
      functionCalling: {
        domains: ['light', 'scene', 'script'],
        serviceDataProperties: {
          brightness: {
            type: 'number',
            description: 'Brightness level for lights (0-255)'
          },
          color_name: {
            type: 'string',
            description: 'Color name for lights (e.g., "red", "blue", "warm")'
          }
        },
        allowAnyDomain: false,
        allowAnyServiceData: true
      }
    };
  };
  
  const haConfig = getHAConfig();
  
  // Helper to get audio config from new structure (gemini.audio) or old structure (top-level audio) for backward compatibility
  const getAudioConfig = () => {
    // Try new structure first (gemini.audio)
    if (userConfig?.gemini?.audio || configData.gemini?.audio) {
      return userConfig?.gemini?.audio || configData.gemini?.audio || {
        outputSampleRate: 24000
      };
    }
    // Fall back to old structure for backward compatibility
    if (userConfig?.audio || configData.audio) {
      return userConfig?.audio || configData.audio || {
        outputSampleRate: 24000
      };
    }
    // Default fallback
    return {
      outputSampleRate: 24000
    };
  };
  
  const audioConfig = getAudioConfig();
  
  return {
    gemini: {
      ...configData.gemini,
      apiKey: userConfig?.gemini?.apiKey || 
              import.meta.env.VITE_GEMINI_API_KEY || 
              configData.gemini.apiKey || '',
      systemInstruction: systemInstruction,
      audio: audioConfig,
      enableGrounding: userConfig?.gemini?.enableGrounding !== undefined 
                       ? userConfig.gemini.enableGrounding 
                       : (configData.gemini.enableGrounding !== undefined 
                          ? configData.gemini.enableGrounding 
                          : false),
      enableAffectiveDialog: userConfig?.gemini?.enableAffectiveDialog !== undefined
                             ? userConfig.gemini.enableAffectiveDialog
                             : (configData.gemini.enableAffectiveDialog !== undefined
                                ? configData.gemini.enableAffectiveDialog
                                : false),
      voiceName: userConfig?.gemini?.voiceName || configData.gemini.voiceName || '',
      languageCode: userConfig?.gemini?.languageCode || configData.gemini.languageCode || '',
      proactiveAudio: userConfig?.gemini?.proactiveAudio !== undefined
                     ? userConfig.gemini.proactiveAudio
                     : (configData.gemini.proactiveAudio !== undefined
                        ? configData.gemini.proactiveAudio
                        : false),
      thinkingConfig: userConfig?.gemini?.thinkingConfig || configData.gemini.thinkingConfig || {
        enabled: false,
        thinkingBudget: null,
        includeThoughts: false
      },
      initialGreeting: userConfig?.gemini?.initialGreeting || configData.gemini.initialGreeting || {
        enabled: false,
        message: ''
      },
      vadConfig: userConfig?.gemini?.vadConfig || configData.gemini.vadConfig || {
        disabled: false,
        startOfSpeechSensitivity: 'START_SENSITIVITY_MEDIUM',
        endOfSpeechSensitivity: 'END_SENSITIVITY_MEDIUM',
        prefixPaddingMs: 20,
        silenceDurationMs: 100
      },
    },
    // Backward compatibility: expose audio at top level
    audio: audioConfig,
    ui: {
      feedbackDuration: userConfig?.ui?.feedbackDuration ?? configData.ui?.feedbackDuration ?? 2000,
      autoDisconnectDelay: userConfig?.ui?.autoDisconnectDelay ?? configData.ui?.autoDisconnectDelay ?? 100,
      connectionMonitorRestoreDelay: userConfig?.ui?.connectionMonitorRestoreDelay ?? configData.ui?.connectionMonitorRestoreDelay ?? 5000,
      noActionTimeout: userConfig?.ui?.noActionTimeout ?? configData.ui?.noActionTimeout ?? 10000
    },
    features: {
      homeAssistant: {
        enabled: haConfig.enabled,
        baseUrl: haConfig.baseUrl,
        accessToken: haConfig.accessToken,
        timeout: haConfig.timeout,
        webSocketConnectionTimeout: haConfig.webSocketConnectionTimeout,
        functionCalling: haConfig.functionCalling
      }
    },
    // Backward compatibility: expose homeAssistant and functionCalling at top level
    homeAssistant: {
      baseUrl: haConfig.baseUrl,
      accessToken: haConfig.accessToken,
      timeout: haConfig.timeout,
      webSocketConnectionTimeout: haConfig.webSocketConnectionTimeout
    },
    functionCalling: haConfig.functionCalling,
  };
}

