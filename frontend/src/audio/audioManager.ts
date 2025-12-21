import { base64ToUint8Array, decodeAudioData } from '../utils/audioUtils';
import { MessageHandlerContext } from '../handlers/messageHandler';

/**
 * Handle audio output from Gemini
 */
export async function handleAudioOutput(
  audioData: string,
  ctx: MessageHandlerContext
): Promise<void> {
  if (!ctx.outputAudioContext) return;
  
  const audioCtx = ctx.outputAudioContext;
  ctx.nextStartTime.value = Math.max(ctx.nextStartTime.value, audioCtx.currentTime);

  try {
    const audioBuffer = await decodeAudioData(
      base64ToUint8Array(audioData),
      audioCtx,
      ctx.OUTPUT_SAMPLE_RATE
    );

    // Resume AudioContext if suspended (required on mobile browsers)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);

    source.addEventListener('ended', () => {
      ctx.audioSources.delete(source);
      // When all audio sources finish, restart the no-action timeout
      // This ensures the session disconnects if user doesn't provide new input
      if (ctx.audioSources.size === 0) {
        ctx.timeoutManager.start();
      }
    });

    source.addEventListener('error', (e) => {
      console.error('❌ Audio source error:', e);
      ctx.audioSources.delete(source);
      // When all audio sources finish (including errors), restart the no-action timeout
      if (ctx.audioSources.size === 0) {
        ctx.timeoutManager.start();
      }
    });

    source.start(ctx.nextStartTime.value);
    ctx.audioSources.add(source);
    ctx.nextStartTime.value += audioBuffer.duration;
  } catch (error) {
    console.error('❌ Error playing audio:', error);
  }
}

/**
 * Handle interruption signal from Gemini
 */
export function handleInterruption(ctx: MessageHandlerContext): void {
  console.log('Interrupted');
  ctx.audioSources.forEach(s => s.stop());
  ctx.audioSources.clear();
  if (ctx.outputAudioContext) {
    ctx.nextStartTime.value = ctx.outputAudioContext.currentTime;
  }
  // After interruption, restart timeout if user has provided input (they're waiting for a response)
  // Note: This will be handled in messageHandler.ts where we have access to currentUserTranscription
}

