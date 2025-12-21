/**
 * Application state management
 * Centralized state for the application
 */

import { CustomHAConfig, HAStateEntry } from '../types/ha';

/**
 * Application state interface
 */
export interface ApplicationState {
  // Connection state
  isConnected: boolean;
  isMicMuted: boolean;

  // Audio contexts and streams
  inputAudioContext: AudioContext | null;
  outputAudioContext: AudioContext | null;
  stream: MediaStream | null;
  processor: AudioWorkletNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;

  // Gemini session
  session: any | null;
  sessionPromise: Promise<any> | null;

  // Function call tracking
  processedFunctionCallIds: Set<string>;
  
  // Message tracking
  messageSequence: number;
  
  // Audio playback
  nextStartTime: number;
  audioSources: Set<AudioBufferSourceNode>;
  
  // User transcription
  currentUserTranscription: string;
  
  // Home Assistant configuration
  haConfig: CustomHAConfig | null;
  haStates: HAStateEntry[] | null;
}

/**
 * Create initial application state
 */
export function createInitialState(): ApplicationState {
  return {
    isConnected: false,
    isMicMuted: false,
    inputAudioContext: null,
    outputAudioContext: null,
    stream: null,
    processor: null,
    sourceNode: null,
    session: null,
    sessionPromise: null,
    processedFunctionCallIds: new Set<string>(),
    messageSequence: 0,
    nextStartTime: 0,
    audioSources: new Set<AudioBufferSourceNode>(),
    currentUserTranscription: '',
    haConfig: null,
    haStates: null,
  };
}
