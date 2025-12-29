/**
 * UI logging utilities
 * Provides standardized logging functions for UI elements
 */

/**
 * Remove emoji/icon characters from a string
 * Matches common emoji patterns including single emojis and emoji sequences
 * Preserves newlines and spacing
 */
function removeEmojis(text: string): string {
  // Remove emoji patterns (including variations and sequences)
  // This regex matches most emoji characters including:
  // - Basic emojis (⚙️, 📋, ✅, etc.)
  // - Emoji with variation selectors
  // - Emoji sequences (flags, skin tones, etc.)
  // Don't trim - preserve newlines and spacing
  // Note: Preserve arrow characters (→ U+2192, ← U+2190, etc.) as they're used in log patterns like "APP → HA"
  // Remove arrow ranges but exclude the specific arrows we use
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{24C2}-\u{1F251}]|[\u{2300}-\u{23FF}]|[\u{2B50}-\u{2B55}]/gu, '')
    .replace(/[\u{2190}-\u{2191}]|[\u{2193}-\u{2199}]|[\u{219B}-\u{21FF}]/gu, ''); // Remove arrows except → (U+2192)
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
 * Create a UI logger function that appends messages to a textarea element
 * Automatically adds timestamps to new log entries and removes emojis
 * Automatically scrolls to the bottom after each message
 * @param uiElement Optional HTMLTextAreaElement to log to
 * @returns A function that takes a message string and appends it to the UI element
 */
export function createUILogger(uiElement?: HTMLTextAreaElement): (message: string) => void {
  return (message: string) => {
    if (uiElement) {
      // Remove emojis from the message (preserves newlines)
      let cleanedMessage = removeEmojis(message);
      
      // Check if message starts with newline - indicates a new entry
      const startsWithNewline = cleanedMessage.startsWith('\n');
      
      // Ensure previous content ends with newline if we're adding new content
      const currentContent = uiElement.value;
      const needsLeadingNewline = currentContent && !currentContent.endsWith('\n') && !startsWithNewline;
      
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
      
      uiElement.value = currentContent + cleanedMessage;
      uiElement.scrollTop = uiElement.scrollHeight;
    }
  };
}

