/**
 * Utility functions for building Gemini API configuration
 */

import { CustomHAConfig } from '../types/ha';
import { AppConfig } from './configLoader';

// Re-export AppConfig for convenience
export type { AppConfig };

/**
 * Build system instruction by concatenating general instruction and enabled feature instructions
 * Supports user overrides via config.features.*.systemInstruction
 * @param generalInstruction The general/base system instruction
 * @param haConfig The Home Assistant configuration (optional, for dynamic data injection)
 * @param appConfig The application configuration (to check enabled features and overrides)
 * @returns The complete system instruction with feature sections concatenated
 */
export function buildSystemInstruction(
  generalInstruction: string,
  haConfig: CustomHAConfig | null,
  appConfig?: AppConfig
): string {
  // Start with the general instruction
  let instruction = generalInstruction || '';
  
  // Build feature capabilities list
  const featureCapabilities: string[] = [];
  
  // Process Home Assistant feature
  const haFeatureEnabled = appConfig?.features?.homeAssistant?.enabled !== false;
  const hasHAConfig = haConfig && haConfig.entities && haConfig.entities.length > 0;
  
  if (haFeatureEnabled && hasHAConfig) {
    featureCapabilities.push('- **Control Home Assistant devices** using the functions below');
    
    // Get HA instruction from config (user override or default)
    let haInstruction = appConfig?.features?.homeAssistant?.systemInstruction;
    
    if (haInstruction) {
      // Replace dynamic placeholders (like HA_CONFIG_JSON)
      if (haConfig.entities && haConfig.entities.length > 0) {
        const configStr = JSON.stringify(haConfig, null, 2);
        haInstruction = haInstruction.replace('{HA_CONFIG_JSON}', configStr);
      }
      
      // Append HA instruction
      if (instruction && !instruction.endsWith('\n')) {
        instruction += '\n';
      }
      instruction += '\n' + haInstruction;
      
      console.log('✅ System instruction built with HA config:', {
        entityCount: haConfig.entities.length,
        hasOverride: !!appConfig?.features?.homeAssistant?.systemInstruction,
        instructionLength: instruction.length
      });
    }
  } else {
    if (!haFeatureEnabled) {
      console.log('ℹ️ Home Assistant feature is disabled');
    } else {
      console.log('⚠️ System instruction built WITHOUT HA config (no entities loaded)');
    }
  }
  
  // Process Reference Sources feature
  const referenceSourcesInstruction = appConfig?.features?.referenceSources?.systemInstruction;
  if (referenceSourcesInstruction) {
    if (instruction && !instruction.endsWith('\n')) {
      instruction += '\n';
    }
    instruction += '\n' + referenceSourcesInstruction;
  }
  
  // Replace feature capabilities placeholder in general instruction
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

