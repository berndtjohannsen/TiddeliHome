/**
 * UI helper utilities
 * Functions for managing UI state and interactions
 */

/**
 * Update UI connection state
 * @param micButton The microphone button element
 * @param statusText The status text element
 * @param connected Whether the connection is active
 * @param status The status message to display
 * @param muteButton Optional mute button element to show/hide
 */
export function updateUIState(
  micButton: HTMLButtonElement,
  statusText: HTMLParagraphElement,
  connected: boolean,
  status: string,
  muteButton?: HTMLButtonElement
): void {
  // SVG icon is already in HTML, just update class (icon stays black via CSS)
  micButton.className = connected ? 'mic-button connected' : 'mic-button';
  statusText.textContent = status;
  
  // Show/hide mute button based on connection state
  if (muteButton) {
    if (connected) {
      muteButton.classList.add('visible');
      // Icon state is controlled by CSS classes
      if (!muteButton.classList.contains('muted')) {
        muteButton.setAttribute('aria-label', 'Mute microphone');
      }
    } else {
      muteButton.classList.remove('visible');
      muteButton.classList.remove('muted');
    }
  }
}

/**
 * Update mute button state
 * @param muteButton The mute button element
 * @param isMuted Whether the microphone is muted
 */
export function updateMuteState(
  muteButton: HTMLButtonElement,
  isMuted: boolean
): void {
  if (isMuted) {
    muteButton.classList.add('muted');
    muteButton.setAttribute('aria-label', 'Unmute microphone');
  } else {
    muteButton.classList.remove('muted');
    muteButton.setAttribute('aria-label', 'Mute microphone');
  }
  // SVG icons are controlled by CSS, no need to change textContent
}

/**
 * Copy text to clipboard with visual feedback
 * @param text The text to copy
 * @param button Optional button element to show feedback on
 * @param feedbackDuration Optional duration in ms for feedback display (default: 2000)
 * @returns Promise that resolves when copy is complete
 */
export async function copyToClipboard(
  text: string,
  button?: HTMLButtonElement,
  feedbackDuration: number = 2000
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const originalText = button.textContent;
      button.textContent = '✅ Copied!';
      button.classList.add('button-feedback-success');
      setTimeout(() => {
        if (button) {
          button.textContent = originalText;
          button.classList.remove('button-feedback-success');
        }
      }, feedbackDuration);
    }
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    if (button) {
      const originalText = button.textContent;
      button.textContent = '❌ Failed';
      button.classList.add('button-feedback-error');
      setTimeout(() => {
        if (button) {
          button.textContent = originalText;
          button.classList.remove('button-feedback-error');
        }
      }, feedbackDuration);
    }
    throw err;
  }
}

/**
 * Toggle debug panel visibility
 * @param panel The debug panel element
 * @param toggleShowButton The button that shows when panel is hidden
 * @returns The new visibility state (true if visible, false if hidden)
 */
export function toggleDebugPanel(
  panel: HTMLDivElement,
  toggleShowButton: HTMLButtonElement
): boolean {
  const isVisible = panel.classList.contains('visible');
  if (isVisible) {
    panel.classList.remove('visible');
    toggleShowButton.classList.remove('js-hidden');
    toggleShowButton.classList.add('js-block');
    return false;
  } else {
    panel.classList.add('visible');
    toggleShowButton.classList.remove('js-block');
    toggleShowButton.classList.add('js-hidden');
    return true;
  }
}
