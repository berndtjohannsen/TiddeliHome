/**
 * Timeout manager for no-action timeout
 * Manages timeout to disconnect session if user doesn't provide input
 */

export interface TimeoutManagerCallbacks {
  onTimeout: () => void;
}

/**
 * Timeout manager class
 */
export class TimeoutManager {
  private timeoutId: NodeJS.Timeout | null = null;
  private timeoutMs: number;
  private callbacks: TimeoutManagerCallbacks;

  constructor(timeoutMs: number, callbacks: TimeoutManagerCallbacks) {
    this.timeoutMs = timeoutMs;
    this.callbacks = callbacks;
  }

  /**
   * Clear the no-action timeout
   */
  clear(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Clear the no-action timeout (same as clear, kept for compatibility)
   */
  clearWithLog(): void {
    this.clear();
    // Silent clear - no logging to reduce console spam
  }

  /**
   * Start the no-action timeout
   * Clears any existing timeout first
   */
  start(): void {
    // Clear any existing timeout first
    this.clear();

    if (!this.timeoutMs || this.timeoutMs <= 0) {
      return;
    }

    this.timeoutId = setTimeout(() => {
      console.warn('⏱️ No-action timeout triggered: No user input for 10 seconds');
      this.callbacks.onTimeout();
    }, this.timeoutMs);
  }

}
