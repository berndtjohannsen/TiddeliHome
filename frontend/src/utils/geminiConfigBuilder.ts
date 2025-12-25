/**
 * Utility functions for building Gemini API configuration
 */

import { CustomHAConfig } from '../types/ha';
import { AppConfig } from './configLoader';

// Re-export AppConfig for convenience
export type { AppConfig };

/**
 * Extract a feature section from template using START/END markers
 * @param template The full template
 * @param featureName The feature name (e.g., "HOME_ASSISTANT")
 * @returns The extracted section content (without markers), or null if not found
 */
export function extractFeatureSection(template: string, featureName: string): string | null {
  const startMarker = `{START_FEATURE_${featureName}}`;
  const endMarker = `{END_FEATURE_${featureName}}`;
  
  const startIndex = template.indexOf(startMarker);
  const endIndex = template.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    return null;
  }
  
  const sectionStart = startIndex + startMarker.length;
  const sectionContent = template.substring(sectionStart, endIndex).trim();
  return sectionContent;
}

/**
 * Remove a feature section from template (including markers)
 * @param template The full template
 * @param featureName The feature name (e.g., "HOME_ASSISTANT")
 * @returns Template with the feature section removed
 */
function removeFeatureSection(template: string, featureName: string): string {
  const startMarker = `{START_FEATURE_${featureName}}`;
  const endMarker = `{END_FEATURE_${featureName}}`;
  
  const startIndex = template.indexOf(startMarker);
  const endIndex = template.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1) {
    return template;
  }
  
  const sectionEnd = endIndex + endMarker.length;
  const before = template.substring(0, startIndex);
  const after = template.substring(sectionEnd);
  
  // Remove any leading/trailing newlines from the section we're removing
  let result = before;
  if (after.length > 0 && !after.startsWith('\n') && !before.endsWith('\n')) {
    result += '\n';
  }
  result += after.trimStart();
  
  return result;
}

/**
 * Build system instruction with feature-based configuration
 * Extracts feature sections from template and conditionally includes them based on enabled features
 * Supports user overrides via config.features.*.systemInstruction
 * @param systemInstructionTemplate The base system instruction template
 * @param haConfig The Home Assistant configuration (optional, for dynamic data injection)
 * @param appConfig The application configuration (to check enabled features and overrides)
 * @returns The complete system instruction with feature sections embedded
 */
export function buildSystemInstruction(
  systemInstructionTemplate: string,
  haConfig: CustomHAConfig | null,
  appConfig?: AppConfig
): string {
  let instruction = systemInstructionTemplate;
  
  // Build feature capabilities list
  const featureCapabilities: string[] = [];
  
  // Process Home Assistant feature
  const haFeatureEnabled = appConfig?.features?.homeAssistant?.enabled !== false;
  const hasHAConfig = haConfig && haConfig.entities && haConfig.entities.length > 0;
  
  if (haFeatureEnabled && hasHAConfig) {
    featureCapabilities.push('- **Control Home Assistant devices** using the functions below');
    
    // Get HA instruction: use override from config if present, otherwise extract from template
    let haInstruction = appConfig?.features?.homeAssistant?.systemInstruction;
    
    if (!haInstruction) {
      // Extract from template
      haInstruction = extractFeatureSection(instruction, 'HOME_ASSISTANT');
    }
    
    if (haInstruction) {
      // Replace dynamic placeholders (like HA_CONFIG_JSON)
      if (haConfig.entities && haConfig.entities.length > 0) {
        const configStr = JSON.stringify(haConfig, null, 2);
        haInstruction = haInstruction.replace('{HA_CONFIG_JSON}', configStr);
      }
      
      // Replace the entire section (with markers) with processed content
      const startMarker = '{START_FEATURE_HOME_ASSISTANT}';
      const endMarker = '{END_FEATURE_HOME_ASSISTANT}';
      const startIndex = instruction.indexOf(startMarker);
      const endIndex = instruction.indexOf(endMarker);
      
      if (startIndex !== -1 && endIndex !== -1) {
        const sectionEnd = endIndex + endMarker.length;
        const before = instruction.substring(0, startIndex);
        const after = instruction.substring(sectionEnd);
        instruction = before + haInstruction + (after.startsWith('\n') ? '' : '\n') + after;
      }
      
      console.log('✅ System instruction built with HA config:', {
        entityCount: haConfig.entities.length,
        hasOverride: !!appConfig?.features?.homeAssistant?.systemInstruction,
        instructionLength: instruction.length
      });
    }
  } else {
    // Remove HA section if feature not enabled or no config
    instruction = removeFeatureSection(instruction, 'HOME_ASSISTANT');
    if (!haFeatureEnabled) {
      console.log('ℹ️ Home Assistant feature is disabled');
    } else {
      console.log('⚠️ System instruction built WITHOUT HA config (no entities loaded)');
    }
  }
  
  // Process Reference Sources feature (placeholder for future document/context feature)
  // For now, we'll remove markers but keep the content (could add enable check in the future)
  const referenceSourcesSection = extractFeatureSection(instruction, 'REFERENCE_SOURCES');
  if (referenceSourcesSection !== null) {
    // Remove the markers but keep the content
    const startMarker = '{START_FEATURE_REFERENCE_SOURCES}';
    const endMarker = '{END_FEATURE_REFERENCE_SOURCES}';
    const startIndex = instruction.indexOf(startMarker);
    const endIndex = instruction.indexOf(endMarker);
    if (startIndex !== -1 && endIndex !== -1) {
      const sectionEnd = endIndex + endMarker.length;
      const before = instruction.substring(0, startIndex);
      const after = instruction.substring(sectionEnd);
      instruction = before + referenceSourcesSection + after;
    }
  }
  
  // Replace feature capabilities placeholder
  const capabilitiesText = featureCapabilities.length > 0 
    ? '\n' + featureCapabilities.join('\n') 
    : '';
  instruction = instruction.replace('{FEATURE_CAPABILITIES}', capabilitiesText);
  
  return instruction;
}

/**
 * Build tools definition for Gemini function calling
 * Uses configurable domains and service_data properties from config
 * @param appConfig The application configuration
 * @returns Array of tool definitions for Gemini API
 */
export function buildTools(appConfig: AppConfig): any[] {
  // Get function calling config from features.homeAssistant (new structure) or top-level (backward compatibility)
  const funcCallingConfig = appConfig.features?.homeAssistant?.functionCalling || appConfig.functionCalling;
  const domains = funcCallingConfig.domains || [];
  
  // Build domain property - always restrict to configured domains
  const domainProperty: any = {
    type: 'string',
    description: 'The domain of the entity to control (e.g., "light", "scene", "script", "switch", "sensor", "climate", "cover", etc.)'
  };
  
  // Add enum constraint if domains are configured (mandatory domain list)
  if (domains.length > 0) {
    domainProperty.enum = domains;
  }
  
  // Build service_data property - always allow any properties (unrestricted object)
  const serviceDataProperty: any = {
    type: 'object',
    description: 'Optional additional service data. Properties depend on the domain and service being called.'
  };
  // Note: serviceDataProperties in config is kept for documentation but not used to restrict the schema
  
  return [
    {
      functionDeclarations: [
        {
          name: 'control_home_assistant',
          description: 'Control Home Assistant devices by calling services. Use this function when the user wants to control any Home Assistant entity (lights, scenes, scripts, switches, sensors, climate, covers, etc.).',
          parameters: {
            type: 'object',
            properties: {
              domain: domainProperty,
              service: {
                type: 'string',
                description: 'The service to call for the domain (e.g., "turn_on", "turn_off", "set_temperature", "open_cover", etc.). Available services depend on the domain.'
              },
              target: {
                type: 'object',
                description: 'Target specification for the service call',
                properties: {
                  entity_id: {
                    type: 'string',
                    description: 'The entity_id of the device to control (e.g., "light.kitchen_corner", "scene.evening", "climate.living_room", etc.)'
                  }
                },
                required: ['entity_id']
              },
              service_data: serviceDataProperty
            },
            required: ['domain', 'service', 'target']
          }
        },
        {
          name: 'get_home_assistant_state',
          description: 'Get the current state of a Home Assistant entity. Use this function when the user asks about the status, state, or current value of a device (e.g., "Is the light on?", "What is the temperature?", "Is the switch on?", "What\'s the brightness?", "Is the door open?").',
          parameters: {
            type: 'object',
            properties: {
              entity_id: {
                type: 'string',
                description: 'The entity_id of the device to query (e.g., "light.kitchen_corner", "climate.living_room", "switch.example", "cover.garage_door", etc.)'
              }
            },
            required: ['entity_id']
          }
        }
      ]
    }
  ] as any;
}

