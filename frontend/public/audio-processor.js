// AudioWorklet processor for processing microphone input
// Runs on a separate audio thread for better performance

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // No initialization needed, but we can add it if needed in the future
  }

  process(inputs, outputs, parameters) {
    // Get input from microphone (inputs[0] is the input port)
    const input = inputs[0];
    
    if (input && input.length > 0) {
      const inputChannel = input[0]; // Mono channel (channel 0)
      
      // Send audio data to main thread via message port
      // Only send if there's actual audio data (length > 0)
      if (inputChannel && inputChannel.length > 0) {
        // Copy Float32Array data (we need to send a copy, not the reference)
        const audioData = new Float32Array(inputChannel);
        this.port.postMessage({
          type: 'audioData',
          data: audioData
          // Note: sampleRate is available as a global in AudioWorkletGlobalScope, but we'll let the main thread use AudioContext.sampleRate instead
        });
      }
    }
    
    // Return true to keep the processor alive
    return true;
  }
}

// Register the processor
registerProcessor('audio-processor', AudioProcessor);
