/**
 * Home Assistant configuration management utilities
 * Handles parsing, storing, and extracting HA configuration
 */

import { CustomHAConfig, HAEntity, HAStateEntry } from '../types/ha';
import { fetchHAEntities, HAEntitiesResult } from '../api/haWebSocket';
import { getHAWebSocketUrl } from './haUrlBuilder';
import { createUILogger } from './uiLogger';
import { AppConfig } from './configLoader';

/**
 * Format entity domain name for display (capitalize first letter only)
 */
function formatDomainName(domain: string): string {
  // Just capitalize first letter, keep the rest as-is from HA
  if (!domain) return domain;
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

/**
 * Get entity-specific hints based on actual capabilities from state
 * @param entity The entity to get hints for
 * @param state Optional state data to check capabilities
 * @returns Hint string describing what can be controlled
 */
function getEntityHints(entity: HAEntity, state: HAStateEntry | undefined): string {
  const domain = entity.domain;
  const attrs = state?.attributes || {};
  
  // For lights, check actual capabilities from supported_color_modes
  if (domain === 'light') {
    const supportedColorModes = attrs.supported_color_modes as string[] | undefined;
    const capabilities: string[] = ['on/off'];
    
    if (supportedColorModes && supportedColorModes.length > 0) {
      // Check if brightness is supported (most lights support this, except on/off only)
      const hasBrightness = supportedColorModes.some(mode => 
        mode !== 'onoff' && mode !== 'unknown'
      );
      if (hasBrightness) {
        capabilities.push('brightness');
      }
      
      // Check if color is supported (hs, rgb, rgbw, rgbww, xy modes)
      const colorModes = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
      const supportsColor = supportedColorModes.some(mode => colorModes.includes(mode));
      if (supportsColor) {
        capabilities.push('color');
      } else if (supportedColorModes.includes('color_temp')) {
        // Color temperature (white spectrum) but not full color
        capabilities.push('color temperature');
      }
    } else {
      // Fallback: assume basic brightness if no supported_color_modes info
      capabilities.push('brightness');
    }
    
    return capabilities.join(', ');
  }
  
  // For other domains, use generic hints
  const hintsMap: Record<string, string> = {
    'switch': 'on/off',
    'scene': 'activate',
    'script': 'run',
    'climate': 'temperature, mode, fan',
    'cover': 'open/close, position',
    'fan': 'on/off, speed',
    'lock': 'lock/unlock',
    'media_player': 'play/pause, volume, source',
    'sensor': 'read state',
    'binary_sensor': 'read state',
    'alarm_control_panel': 'arm/disarm',
    'vacuum': 'start/stop, dock'
  };
  return hintsMap[domain] || 'control';
}

/**
 * Format entity state for display based on domain
 * @returns HTML string with state formatted, or empty string if no state
 */
function formatEntityState(entity: HAEntity, state: HAStateEntry | undefined): string {
  if (!state) return '';
  
  const domain = entity.domain;
  const stateValue = state.state;
  const attrs = state.attributes || {};
  
  let stateText = '';
  
  switch (domain) {
    case 'light':
    case 'switch':
    case 'fan':
      stateText = stateValue === 'on' ? 'on' : stateValue === 'off' ? 'off' : '';
      break;
    case 'cover':
      if (stateValue === 'open') stateText = 'open';
      else if (stateValue === 'closed') stateText = 'closed';
      else if (attrs.current_position !== undefined) stateText = `${attrs.current_position}%`;
      break;
    case 'climate':
      if (attrs.temperature !== undefined) {
        stateText = `${attrs.temperature}°C`;
      } else if (stateValue) {
        stateText = stateValue;
      }
      break;
    case 'sensor':
    case 'binary_sensor':
      // Show state value if it's meaningful (not just "unknown")
      if (stateValue && stateValue !== 'unknown' && stateValue !== 'unavailable') {
        // For numeric sensors, show unit if available
        if (attrs.unit_of_measurement) {
          stateText = `${stateValue} ${attrs.unit_of_measurement}`;
        } else {
          stateText = stateValue;
        }
      }
      break;
    case 'lock':
      stateText = stateValue === 'locked' ? 'locked' : stateValue === 'unlocked' ? 'unlocked' : '';
      break;
    default:
      // For other domains, just show state if it's meaningful
      if (stateValue && stateValue !== 'unknown' && stateValue !== 'unavailable') {
        stateText = stateValue;
      }
      break;
  }
  
  return stateText ? ` <span class="entity-state">(${stateText})</span>` : '';
}

/**
 * Render entities grouped by domain as HTML
 * Helper function to avoid duplication in formatHAConfigSummary
 * @param entities Array of entities to render
 * @param states Optional current states for entities
 * @param html Current HTML string to append to
 * @returns Updated HTML string with entities rendered
 */
function renderEntitiesByDomain(
  entities: HAEntity[],
  states: HAStateEntry[] | undefined,
  html: string
): string {
  // Group entities by domain
  const byDomain = new Map<string, HAEntity[]>();
  entities.forEach(entity => {
    if (!byDomain.has(entity.domain)) {
      byDomain.set(entity.domain, []);
    }
    byDomain.get(entity.domain)!.push(entity);
  });

  // Show entities grouped by domain
  Array.from(byDomain.entries()).sort().forEach(([domain, domainEntities]) => {
    domainEntities.forEach((entity) => {
      // Find matching state for this entity
      const entityState = states?.find(s => s.entity_id === entity.entity_id);
      const stateDisplay = formatEntityState(entity, entityState);
      // Get entity-specific hints based on actual capabilities
      const entityHint = getEntityHints(entity, entityState);
      
      html += `<div class="entity-item">`;
      html += entity.name || entity.entity_id;
      html += stateDisplay; // Show current state
      html += ` - <span class="domain-badge">${formatDomainName(domain)}</span>`;
      html += ` <span class="domain-hint">(${entityHint})</span>`;
      html += '</div>';
    });
  });
  
  return html;
}

/**
 * Format HA config summary for user-friendly display
 * @param config The HA configuration to summarize
 * @param states Optional current states for entities (for display only, not part of config)
 * @returns HTML string with formatted summary
 */
export function formatHAConfigSummary(config: CustomHAConfig, states?: HAStateEntry[]): string {
  if (!config || !config.entities || config.entities.length === 0) {
    return '<p>No entities found.</p>';
  }

  const entities = config.entities;
  const totalEntities = entities.length;
  
  // Group entities by area
  const entitiesByArea = new Map<string, HAEntity[]>();
  const entitiesWithoutArea: HAEntity[] = [];
  
  entities.forEach(entity => {
    if (entity.area && entity.area.trim()) {
      if (!entitiesByArea.has(entity.area)) {
        entitiesByArea.set(entity.area, []);
      }
      entitiesByArea.get(entity.area)!.push(entity);
    } else {
      entitiesWithoutArea.push(entity);
    }
  });

  // Get unique domains
  const domains = [...new Set(entities.map(e => e.domain))].sort();

  let html = '<div class="summary-stats">';
  html += `<strong>${totalEntities}</strong> entity${totalEntities !== 1 ? 'ies' : ''} across <strong>${entitiesByArea.size}</strong> area${entitiesByArea.size !== 1 ? 's' : ''}`;
  if (entitiesWithoutArea.length > 0) {
    html += ` (${entitiesWithoutArea.length} without area)`;
  }
  html += '</div>';

  // Show domains summary
  html += '<div class="summary-stats">';
  html += '<strong>Available controls:</strong> ';
  html += domains.map(d => `<span class="domain-badge">${formatDomainName(d)}</span>`).join('');
  html += '</div>';

  // Show entities grouped by area
  if (entitiesByArea.size > 0) {
    html += '<h4>By Room/Area:</h4>';
    
    // Sort areas alphabetically
    const sortedAreas = Array.from(entitiesByArea.entries()).sort((a, b) => 
      a[0].localeCompare(b[0])
    );

    sortedAreas.forEach(([areaName, areaEntities]) => {
      html += `<div class="area-group">`;
      html += `<div class="area-name">${areaName}</div>`;
      html += '<div class="entity-list">';
      
      // Render entities grouped by domain using helper function
      html = renderEntitiesByDomain(areaEntities, states, html);
      
      html += '</div>';
      html += '</div>';
    });
  }

  // Show entities without area
  if (entitiesWithoutArea.length > 0) {
    html += '<h4>No Area Assigned:</h4>';
    html += '<div class="area-group">';
    html += '<div class="entity-list">';
    
    // Render entities grouped by domain using helper function
    html = renderEntitiesByDomain(entitiesWithoutArea, states, html);
    
    html += '</div>';
    html += '</div>';
  }

  return html;
}

/**
 * Parse and store HA config from text
 * Handles both direct entity array and CustomHAConfig format
 * @param configText The JSON text to parse
 * @param onError Callback to handle errors
 * @returns The parsed HA config, or null if parsing failed
 */
export function parseHAConfig(
  configText: string,
  onError?: (error: string) => void
): CustomHAConfig | null {
  const trimmed = configText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    // Handle both direct entity array and CustomHAConfig format
    const config: CustomHAConfig = parsed.entities ? parsed : { entities: parsed };
    console.log('HA config loaded:', {
      entityCount: config?.entities?.length || 0,
      type: Array.isArray(config?.entities) ? 'array' : typeof config
    });
    return config;
  } catch (error) {
    console.error('Invalid JSON in HA config:', error);
    if (onError) {
      onError('Error: Invalid JSON in HA config');
    }
    return null;
  }
}

/**
 * Update HA config from textarea input
 * @param textarea The textarea element containing the config
 * @param onConfigUpdate Callback when config is successfully updated
 * @param onError Callback to handle errors
 * @param summaryElement Optional element to display config summary
 * @param summarySectionElement Optional element containing the summary (to show/hide)
 * @returns The updated config, or null if update failed
 */
export function updateHAConfigFromTextarea(
  textarea: HTMLTextAreaElement,
  onConfigUpdate?: (config: CustomHAConfig) => void,
  onError?: (error: string) => void,
  summaryElement?: HTMLElement,
  summarySectionElement?: HTMLElement
): CustomHAConfig | null {
  const configText = textarea.value.trim();
  if (!configText) {
    console.log('HA config cleared');
    return null;
  }

  const config = parseHAConfig(configText, onError);
  if (config) {
    // Update summary if elements are provided (no states when pasting, states only available during extraction)
    if (summaryElement) {
      summaryElement.innerHTML = formatHAConfigSummary(config);
    }
    if (summarySectionElement && config.entities && config.entities.length > 0) {
      summarySectionElement.classList.remove('js-hidden');
      summarySectionElement.classList.add('js-block');
    } else if (summarySectionElement) {
      summarySectionElement.classList.remove('js-block');
      summarySectionElement.classList.add('js-hidden');
    }
    
    if (onConfigUpdate) {
      onConfigUpdate(config);
    }
    return config;
  } else {
    // Hide summary on parse error or empty
    if (summarySectionElement) {
      summarySectionElement.classList.remove('js-block');
      summarySectionElement.classList.add('js-hidden');
    }
  }
  return null;
}

/**
 * Handle file upload for HA config
 * @param file The uploaded file
 * @param textarea The textarea to populate with file contents
 * @param fileNameDisplay Optional element to display the file name
 * @param onConfigUpdate Callback when config is successfully updated
 * @param onError Callback to handle errors
 * @returns Promise that resolves with the parsed config, or null if failed
 */
export async function handleHAConfigFileUpload(
  file: File,
  textarea: HTMLTextAreaElement,
  fileNameDisplay?: HTMLElement,
  onConfigUpdate?: (config: CustomHAConfig) => void,
  onError?: (error: string) => void
): Promise<CustomHAConfig | null> {
  // Update file name display
  if (fileNameDisplay) {
    fileNameDisplay.textContent = `Loaded: ${file.name}`;
  }

  try {
    const text = await file.text();
    
    // Populate textarea with file contents
    textarea.value = text;
    
    // Parse and store config
    const config = parseHAConfig(text, onError);
    if (config) {
      console.log('HA config loaded from file:', {
        fileName: file.name,
        fileSize: file.size,
        entityCount: config?.entities?.length || 0,
        type: Array.isArray(config?.entities) ? 'array' : typeof config
      });
      if (onConfigUpdate) {
        onConfigUpdate(config);
      }
      return config;
    } else {
      if (fileNameDisplay) {
        fileNameDisplay.textContent = `Error: Invalid JSON`;
      }
      return null;
    }
  } catch (error) {
    console.error('Error reading file:', error);
    if (onError) {
      onError('Error reading file');
    }
    if (fileNameDisplay) {
      fileNameDisplay.textContent = `Error reading file`;
    }
    return null;
  }
}

/**
 * Extract HA config from Home Assistant via WebSocket
 * @param appConfig The application configuration
 * @param button The extract button element
 * @param statusElement The status display element
 * @param textarea The textarea to populate with extracted config
 * @param logElement Optional textarea element for logging
 * @param messageSequenceRef Reference to message sequence counter (will be incremented)
 * @param onConfigUpdate Callback when config is successfully extracted
 * @param onError Callback to handle errors
 * @returns Promise that resolves with the extracted config, or null if failed
 */
export async function extractHAConfigFromHomeAssistant(
  appConfig: AppConfig,
  button: HTMLButtonElement,
  statusElement: HTMLElement,
  textarea: HTMLTextAreaElement,
  logElement?: HTMLTextAreaElement,
  messageSequenceRef?: { value: number },
  onConfigUpdate?: (config: CustomHAConfig) => void,
  onError?: (error: string) => void,
  summaryElement?: HTMLElement,
  summarySectionElement?: HTMLElement,
  onStatesUpdate?: (states: HAStateEntry[]) => void
): Promise<CustomHAConfig | null> {
  // Validate HA config
  if (!appConfig.homeAssistant.baseUrl || !appConfig.homeAssistant.accessToken) {
    statusElement.textContent = 'Error: Missing HA configuration. Please set baseUrl and accessToken in config.json or .env';
    statusElement.className = 'debug-extract-status error';
    console.error('HA Config check:', {
      baseUrl: appConfig.homeAssistant.baseUrl,
      hasAccessToken: !!appConfig.homeAssistant.accessToken,
      accessTokenLength: appConfig.homeAssistant.accessToken?.length || 0
    });
    return null;
  }
  
  // Build WebSocket URL
  const wsUrl = getHAWebSocketUrl(appConfig.homeAssistant.baseUrl);
  console.log('HA Config:', {
    baseUrl: appConfig.homeAssistant.baseUrl,
    webSocketUrl: wsUrl,
    accessTokenPreview: appConfig.homeAssistant.accessToken ? 
      `${appConfig.homeAssistant.accessToken.substring(0, 10)}...` : 'MISSING',
    accessTokenLength: appConfig.homeAssistant.accessToken?.length || 0
  });

  // Disable button and show loading state
  button.disabled = true;
  button.textContent = '⏳ Extracting...';
  statusElement.textContent = 'Connecting to Home Assistant...';
  statusElement.className = 'debug-extract-status loading';

  // Log to UI debug panel
  const logToUI = createUILogger(logElement);

  const seq = messageSequenceRef ? ++messageSequenceRef.value : 0;
  const timestamp = new Date().toISOString();
  
  logToUI(`\n📤 APP → HA [${timestamp}] [#${seq}] (WebSocket)\n`);
  logToUI(`🔌 Connecting to HA WebSocket for config extraction\n`);
  logToUI(`   URL: ${wsUrl.replace(/\/api\/websocket$/, '')}...\n`);
  logToUI(`   Purpose: Fetch entity/device/area registries\n`);

  try {
    console.log('Extracting HA config from:', wsUrl);
    const result = await fetchHAEntities(
      wsUrl,
      appConfig.homeAssistant.accessToken,
      logToUI,
      appConfig.functionCalling.domains,
      appConfig.homeAssistant.webSocketConnectionTimeout
    );

    // Extract config and states separately (config for AI, states for display)
    const extractedConfig = result.config;
    const extractedStates = result.states;

    // Update textarea with the config only (no states mixed in)
    textarea.value = JSON.stringify(extractedConfig, null, 2);
    
    // Show user-friendly summary with states for display
    if (summaryElement) {
      summaryElement.innerHTML = formatHAConfigSummary(extractedConfig, extractedStates);
    }
    if (summarySectionElement) {
      summarySectionElement.classList.remove('js-hidden');
      summarySectionElement.classList.add('js-block');
    }
    
    // Show success message
    statusElement.textContent = `✅ Successfully extracted ${extractedConfig.entities.length} entities`;
    statusElement.className = 'debug-extract-status success';
    
    const responseTimestamp = new Date().toISOString();
    logToUI(`\n📥 HA → APP [${responseTimestamp}] [#${seq}] (WebSocket)\n`);
    logToUI(`✅ Config extraction successful\n`);
    logToUI(`   Entities extracted: ${extractedConfig.entities.length}\n`);
    const domains = [...new Set(extractedConfig.entities.map(e => e.domain))];
    logToUI(`   Domains: ${domains.join(', ')}\n`);
    
    console.log('HA config extracted successfully:', {
      entityCount: extractedConfig.entities.length,
      domains: domains,
      areas: [...new Set(extractedConfig.entities.map(e => e.area).filter(a => a))]
    });

    // Update config callback (config only, no states)
    if (onConfigUpdate) {
      onConfigUpdate(extractedConfig);
    }
    
    // Update states callback separately (for display purposes)
    if (onStatesUpdate) {
      onStatesUpdate(extractedStates);
    }
    
    return extractedConfig;
  } catch (error) {
    console.error('Error extracting HA config:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    statusElement.textContent = `❌ Error: ${errorMsg}`;
    statusElement.className = 'debug-extract-status error';
    
    const errorTimestamp = new Date().toISOString();
    logToUI(`\n❌ ERROR [${errorTimestamp}] [#${seq}]\n`);
    logToUI(`   ${errorMsg}\n`);
    
    if (onError) {
      onError(errorMsg);
    }
    
    return null;
  } finally {
    // Re-enable button
    button.disabled = false;
    button.textContent = '🔄 Extract HA Config from Home Assistant';
  }
}

