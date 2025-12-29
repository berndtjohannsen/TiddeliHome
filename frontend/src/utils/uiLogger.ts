/**
 * UI logging utilities
 * Provides standardized logging functions for UI elements
 */

/**
 * Log levels
 */
export type LogLevel = 'normal' | 'debug';

/**
 * Get current log level from localStorage or default to 'normal'
 */
function getCurrentLogLevel(): LogLevel {
  const stored = localStorage.getItem('debug_log_level');
  return (stored === 'normal' || stored === 'debug') ? stored : 'normal';
}

/**
 * Set current log level in localStorage
 */
export function setLogLevel(level: LogLevel): void {
  localStorage.setItem('debug_log_level', level);
}

/**
 * Get current log level (exported for external use)
 */
export function getLogLevel(): LogLevel {
  return getCurrentLogLevel();
}

/**
 * Format timestamp for log entries
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Check if a line starts a new log entry
 * New entries are typically:
 * - Not indented (don't start with spaces)
 * - Start with uppercase letter or specific patterns
 */
function isNewLogEntryLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  
  // Skip if line is indented (starts with spaces) - these are continuation lines
  if (line.startsWith('   ') || line.startsWith('\t')) {
    return false;
  }
  
  // Check for patterns that indicate a new log entry:
  // - All uppercase words (like "CONFIG LOADED")
  // - Arrow patterns (like "APP → HA", "AI → APP", "HA → APP") - handle multiple spaces
  // - Error patterns
  // - Connection/Config patterns
  const firstChar = trimmed[0];
  const isUppercase = firstChar >= 'A' && firstChar <= 'Z';
  const hasArrowPattern = /^[A-Z]+\s+→\s+[A-Z]+/.test(trimmed); // Match with spaces around arrow
  const isErrorPattern = /^ERROR/.test(trimmed);
  const isConnectionPattern = /^(Connection|WebSocket|Config|Timeout|Affective|HA CONFIG|APP\s+→|HA\s+→|AI\s+→)/.test(trimmed);
  const isAllUppercase = /^[A-Z][A-Z\s]+$/.test(trimmed); // All caps like "CONFIG LOADED"
  
  return (isUppercase && isAllUppercase) || hasArrowPattern || isErrorPattern || isConnectionPattern;
}

/**
 * Maximum log size in characters (100KB)
 * When exceeded, oldest entries are removed to keep log manageable
 */
const MAX_LOG_SIZE = 100 * 1024; // 100KB

/**
 * Percentage of log to keep when trimming (keep most recent 80%)
 */
const LOG_TRIM_PERCENTAGE = 0.8;

/**
 * Create a UI logger function that appends messages to a textarea element
 * Automatically adds timestamps to new log entries
 * Automatically scrolls to the bottom after each message
 * Filters messages based on current log level setting
 * Automatically trims log when it exceeds MAX_LOG_SIZE
 * @param uiElement Optional HTMLTextAreaElement to log to
 * @returns A function that takes a message string and optional log level, and appends it to the UI element
 */
export function createUILogger(uiElement?: HTMLTextAreaElement): (message: string, level?: LogLevel) => void {
  return (message: string, level: LogLevel = 'normal') => {
    if (uiElement) {
      // Check log level - only show messages that match or are below current level
      const currentLevel = getCurrentLogLevel();
      
      // If current level is 'normal', only show 'normal' messages
      // If current level is 'debug', show both 'normal' and 'debug' messages
      if (currentLevel === 'normal' && level === 'debug') {
        return; // Skip debug messages when log level is normal
      }
      
      // Continue with normal message processing
      // Use message as-is (no emoji removal needed since source messages don't contain emojis)
      let cleanedMessage = message;
      
      // Check if message starts with newline - indicates a new entry
      const startsWithNewline = cleanedMessage.startsWith('\n');
      
      // Ensure previous content ends with newline if we're adding new content
      const currentContent = uiElement.value;
      const needsLeadingNewline = currentContent && !currentContent.endsWith('\n') && !startsWithNewline;
      
      // Check log size and trim if necessary (before adding new content)
      let contentToUse = currentContent;
      if (currentContent && currentContent.length > MAX_LOG_SIZE) {
        // Trim log: keep most recent entries (last 80% of max size)
        const targetSize = Math.floor(MAX_LOG_SIZE * LOG_TRIM_PERCENTAGE);
        const trimmedContent = currentContent.slice(-targetSize);
        
        // Find the first complete log entry (after a newline with timestamp pattern)
        // This ensures we don't cut in the middle of an entry
        const firstNewlineIndex = trimmedContent.indexOf('\n[');
        if (firstNewlineIndex > 0 && firstNewlineIndex < trimmedContent.length) {
          contentToUse = trimmedContent.slice(firstNewlineIndex);
          // Add a marker to indicate log was trimmed
          contentToUse = `\n[${formatTimestamp()}] LOG TRIMMED (oldest entries removed to prevent excessive memory usage)\n${contentToUse}`;
        } else {
          contentToUse = trimmedContent;
        }
      }
      
      // Split message into lines to process each line individually
      const lines = cleanedMessage.split('\n');
      const processedLines: string[] = [];
      
      // Find the first non-empty line index (for timestamp detection)
      let firstNonEmptyLineIndex = -1;
      for (let j = 0; j < lines.length; j++) {
        if (lines[j].trim() !== '') {
          firstNonEmptyLineIndex = j;
          break;
        }
      }
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const isFirstNonEmptyLine = i === firstNonEmptyLineIndex;
        
        // Handle empty lines - preserve them
        if (trimmed === '') {
          processedLines.push('');
          continue;
        }
        
        // Determine if this line should get a timestamp
        // Add timestamp if:
        // 1. It's the first non-empty line AND (message starts with \n OR needs leading newline) AND line matches new entry pattern, OR
        // 2. Previous line was empty AND current line matches new entry pattern
        const prevLineWasEmpty = i > 0 && lines[i - 1].trim() === '';
        const shouldAddTimestamp = 
          (isFirstNonEmptyLine && (startsWithNewline || needsLeadingNewline) && isNewLogEntryLine(line)) ||
          (prevLineWasEmpty && isNewLogEntryLine(line));
        
        if (shouldAddTimestamp) {
          const timestamp = formatTimestamp();
          if (isFirstNonEmptyLine && (startsWithNewline || needsLeadingNewline)) {
            processedLines.push(`\n[${timestamp}] ${trimmed}`);
          } else {
            processedLines.push(`[${timestamp}] ${trimmed}`);
          }
        } else {
          // Continuation line - keep as is (preserve indentation and formatting)
          processedLines.push(line);
        }
      }
      
      cleanedMessage = processedLines.join('\n');
      
      // Update content (using trimmed content if log was too large)
      uiElement.value = contentToUse + cleanedMessage;
      uiElement.scrollTop = uiElement.scrollHeight;
    }
  };
}

/**
 * Clear the log textarea
 * @param uiElement Optional HTMLTextAreaElement to clear
 */
export function clearLog(uiElement?: HTMLTextAreaElement): void {
  if (uiElement) {
    uiElement.value = '';
  }
}

