/**
 * Configuration management utilities
 * Handles saving and loading user configuration from localStorage
 */

import { AppConfig } from './configLoader';

/**
 * Save configuration to localStorage
 * @param config Partial configuration to save (will be merged with existing)
 */
export function saveConfigToStorage(config: Partial<AppConfig>): void {
  try {
    // Get existing config from localStorage
    const existingConfigStr = localStorage.getItem('tiddelihome_config');
    const existingConfig = existingConfigStr ? JSON.parse(existingConfigStr) : {};
    
    // Deep merge new config with existing
    const mergedConfig = deepMerge(existingConfig, config);
    
    // Save to localStorage
    localStorage.setItem('tiddelihome_config', JSON.stringify(mergedConfig));
    console.log('Configuration saved to localStorage');
  } catch (error) {
    console.error('Error saving configuration to localStorage:', error);
    throw new Error('Failed to save configuration');
  }
}

/**
 * Load configuration from localStorage
 * @returns User configuration object or null if not found
 */
export function loadConfigFromStorage(): Partial<AppConfig> | null {
  try {
    const configStr = localStorage.getItem('tiddelihome_config');
    if (!configStr) return null;
    
    return JSON.parse(configStr);
  } catch (error) {
    console.error('Error loading configuration from localStorage:', error);
    return null;
  }
}

/**
 * Deep merge two objects
 */
function deepMerge(target: any, source: any): any {
  const output = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  
  return output;
}

function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item);
}
