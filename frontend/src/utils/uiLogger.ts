/**
 * UI logging utilities
 * Provides standardized logging functions for UI elements
 */

/**
 * Create a UI logger function that appends messages to a textarea element
 * Automatically scrolls to the bottom after each message
 * @param uiElement Optional HTMLTextAreaElement to log to
 * @returns A function that takes a message string and appends it to the UI element
 */
export function createUILogger(uiElement?: HTMLTextAreaElement): (message: string) => void {
  return (message: string) => {
    if (uiElement) {
      const currentContent = uiElement.value;
      uiElement.value = currentContent + message;
      uiElement.scrollTop = uiElement.scrollHeight;
    }
  };
}

