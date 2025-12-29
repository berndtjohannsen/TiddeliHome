/**
 * Home Assistant WebSocket API client
 * Fetches entity registry, device registry, and area registry via WebSocket
 * Converts HA data into custom JSON structure for AI context
 */

import { HAEntity, CustomHAConfig, HAWebSocketMessage, HAAreaRegistryEntry, HADeviceRegistryEntry, HAEntityRegistryEntry, HAStateEntry } from '../types/ha';

/**
 * Result type containing both config and states (states kept separate from config)
 */
export interface HAEntitiesResult {
  config: CustomHAConfig;
  states: HAStateEntry[]; // Current states for display purposes only (not part of config)
}

/**
 * Fetch Home Assistant entities and convert to custom JSON structure
 * @param haHost WebSocket URL (e.g., "ws://homeassistant.local:8123/api/websocket")
 * @param haToken Long-lived access token
 * @returns Custom HA configuration structure
 */
export async function fetchHAEntities(
  haHost: string,
  haToken: string,
  logToUI?: (message: string, level?: 'normal' | 'debug') => void,
  domains?: string[],
  connectionTimeout?: number
): Promise<HAEntitiesResult> {
  return new Promise((resolve, reject) => {
    // Security: Never log tokens or sensitive information
    // Validate inputs
    if (!haHost || typeof haHost !== 'string') {
      reject(new Error(`Invalid WebSocket URL: ${haHost}`));
      return;
    }
    
    if (!haToken || typeof haToken !== 'string' || haToken.length === 0) {
      reject(new Error('Home Assistant access token is required'));
      return;
    }
    
    const ws = new WebSocket(haHost);
    
    if (logToUI) {
      logToUI(`   WebSocket state: Connecting...\n`, 'normal');
      logToUI(`   Initial readyState: ${ws.readyState}\n`, 'debug');
    }
    
    // Add connection timeout
    const timeoutMs = connectionTimeout || 5000;
    const connectionTimeoutId = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket connection timeout');
          if (logToUI) {
            logToUI(`   Connection timeout\n`, 'normal');
          }
        ws.close();
        reject(new Error('WebSocket connection timeout. Check if Home Assistant WebSocket is accessible.'));
      }
    }, timeoutMs);
    
    let idCounter = 1;
    const pendingRequests = new Map<number, string>(); // Track request types
    
    const send = (payload: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      } else {
        console.warn('WebSocket not open, cannot send:', payload);
      }
    };

    const areas: Record<string, string> = {}; // area_id -> area_name
    const devices: Record<string, string | null> = {}; // device_id -> area_id
    const entities: { entity_id: string; device_id: string | null; name?: string | null; labels?: string[] }[] = [];
    
    // Track which registries have been loaded
    let areasLoaded = false;
    let devicesLoaded = false;
    let entitiesLoaded = false;
    let statesData: HAStateEntry[] | null = null;
    
    // Process states only when all registries are loaded
    function processStatesIfReady() {
      if (!areasLoaded || !devicesLoaded || !entitiesLoaded || !statesData) {
        return; // Wait for all registries
      }
      
      const result: HAEntity[] = [];
      
      // Use provided domains from config, or fall back to default
      // Domains list is mandatory - always filter by domain whitelist
      const includedDomains = domains && domains.length > 0 ? domains : ['scene', 'script', 'light'];

      statesData.forEach((state) => {
        // Only include entities that exist in registry
        const registryEntry = entities.find((e) => e.entity_id === state.entity_id);
        if (!registryEntry) return;

        // Extract domain from entity_id (e.g., "light.kitchen_corner" -> "light")
        const domain = state.entity_id.split(".")[0];
        
        // Normalize label comparison: HA may store labels with hyphens or underscores
        const entityLabels = registryEntry.labels ?? [];
        const normalizeLabel = (label: string) => label.toLowerCase().replace(/-/g, '_');
        
        // Exclude entities with "no_use-by_ai" label regardless of domain
        const hasNoAIUseLabel = entityLabels.some(label => 
          normalizeLabel(label) === normalizeLabel("no_use-by_ai")
        );
        if (hasNoAIUseLabel) {
          return; // Exclude this entity
        }
        
        // Check if entity should be included - always filter by domain whitelist
        const hasAIUseLabel = entityLabels.some(label => 
          normalizeLabel(label) === normalizeLabel("use-by-ai")
        );
        
        // Check if domain is in the allowed list
        const isIncludedDomain = includedDomains.includes(domain);
        
        // Special handling: entities with "use-by-ai" label are always included
        // even if their domain is not in the domains list
        // This allows selective inclusion of entities from domains not in the main list
        // (e.g., specific sensors or switches when their domain is excluded)
        
        // Debug logging for entities with use-by-ai label that aren't in the domain list
        if (hasAIUseLabel && !isIncludedDomain) {
          // Entity with use-by-ai label - no need to log
        }
        
        // Exclude if domain is not in allowed list (unless it has use-by-ai label)
        // Since we always filter by domain whitelist now, exclude if not in list and no special label
        if (!isIncludedDomain && !hasAIUseLabel) {
          return;
        }

        // Map device -> area
        const deviceAreaId = registryEntry.device_id 
          ? devices[registryEntry.device_id] 
          : null;
        const areaName = deviceAreaId ? areas[deviceAreaId] : "";

        // Get name: prefer entity registry name, then friendly_name from state, then entity_id
        const registryName = registryEntry.name;
        const stateFriendlyName = state.attributes?.friendly_name;
        const finalName = registryName || stateFriendlyName || state.entity_id;
        
        // Name resolution - no need to log

        // Extract capabilities from state attributes (for lights, check supported_color_modes)
        const capabilities: any = {};
        if (domain === 'light') {
          const supportedColorModes = state.attributes?.supported_color_modes as string[] | undefined;
          if (supportedColorModes && supportedColorModes.length > 0) {
            // Check if brightness is supported (most lights support this, except on/off only)
            const hasBrightness = supportedColorModes.some(mode => 
              mode !== 'onoff' && mode !== 'unknown'
            );
            capabilities.supports_brightness = hasBrightness;
            
            // Check if color is supported (hs, rgb, rgbw, rgbww, xy modes)
            const colorModes = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
            const supportsColor = supportedColorModes.some(mode => colorModes.includes(mode));
            capabilities.supports_color = supportsColor;
            
            // Color temperature (white spectrum) but not full color
            if (!supportsColor && supportedColorModes.includes('color_temp')) {
              capabilities.supports_color_temp = true;
            }
          } else {
            // Fallback: assume basic brightness if no supported_color_modes info
            capabilities.supports_brightness = true;
          }
        }
        
        const entityToAdd: HAEntity = {
          entity_id: state.entity_id,
          name: finalName,
          area: areaName || "",
          domain: domain,
          ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
        };
        
        // Entity with use-by-ai label added - no need to log
        
        result.push(entityToAdd);
      });

      if (logToUI) {
        logToUI(`   Built config with ${result.length} entities\n`, 'debug');
        logToUI(`   Areas: ${Object.keys(areas).length}, Devices: ${Object.keys(devices).length}\n`, 'debug');
      }
      
      // Filter states to only include entities that are in the result (same filtering logic)
      const entityIdsInResult = new Set(result.map(e => e.entity_id));
      const filteredStates = (statesData || []).filter(state => entityIdsInResult.has(state.entity_id));
      
      // Close the WebSocket connection cleanly after extraction completes
      // Use close code 1000 (Normal Closure) to indicate intentional closure
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Config extraction completed');
          if (logToUI) {
            logToUI(`   Closing WebSocket connection (extraction complete)\n`, 'normal');
          }
        }
      } catch (closeError) {
        // Log but don't fail - we already have the data
        if (logToUI) {
          logToUI(`   Warning: Error closing WebSocket: ${closeError instanceof Error ? closeError.message : String(closeError)}\n`, 'debug');
        }
      }
      
      resolve({ 
        config: { entities: result },
        states: filteredStates // Return states separately, not mixed with config
      });
    }

    ws.onopen = () => {
        if (logToUI) {
          logToUI(`   WebSocket state: Connected\n`, 'normal');
          logToUI(`   Sending auth message...\n`, 'normal');
        }
      clearTimeout(connectionTimeoutId);
      // Authenticate
      send({ type: "auth", access_token: haToken });
    };

    ws.onmessage = (event) => {
      try {
        const msg: HAWebSocketMessage = JSON.parse(event.data as string);

        // Log key messages (truncated)
        if (logToUI) {
          if (msg.type === 'auth_required' || msg.type === 'auth_ok') {
            logToUI(`   Received: ${msg.type}\n`, 'normal');
          } else if (msg.type === 'result') {
            const requestType = pendingRequests.get(msg.id!);
            if (requestType) {
              const truncatedType = requestType.length > 40 ? requestType.substring(0, 37) + '...' : requestType;
              const success = (msg as any).success !== false; // Type assertion for success property
              logToUI(`   Received: ${truncatedType} result (${success ? 'success' : 'error'})\n`, 'normal');
            }
          }
        }

        if (msg.type === "auth_ok") {
          if (logToUI) {
            logToUI(`   Authenticated, fetching registries...\n`, 'debug');
          }
          
          // Fetch area registry
          const areaId = idCounter++;
          pendingRequests.set(areaId, "area_registry");
          send({ id: areaId, type: "config/area_registry/list" });
          
          // Fetch device registry
          const deviceId = idCounter++;
          pendingRequests.set(deviceId, "device_registry");
          send({ id: deviceId, type: "config/device_registry/list" });
          
          // Fetch entity registry
          const entityId = idCounter++;
          pendingRequests.set(entityId, "entity_registry");
          send({ id: entityId, type: "config/entity_registry/list" });
          
          // Fetch current states to get friendly_name
          const statesId = idCounter++;
          pendingRequests.set(statesId, "states");
          send({ id: statesId, type: "get_states" });
        }

        if (msg.type === "auth_invalid") {
          reject(new Error("HA WebSocket authentication failed: Invalid token"));
          ws.close();
          return;
        }

        const requestType = pendingRequests.get(msg.id!);
        
        // Handle area registry
        if (requestType === "area_registry" && msg.result) {
          const areaEntries = msg.result as HAAreaRegistryEntry[];
          areaEntries.forEach((a) => {
            areas[a.area_id] = a.name;
          });
          areasLoaded = true;
          if (logToUI) {
            logToUI(`   Loaded ${areaEntries.length} areas\n`, 'debug');
          }
          processStatesIfReady();
        }

        // Handle device registry
        if (requestType === "device_registry" && msg.result) {
          const deviceEntries = msg.result as HADeviceRegistryEntry[];
          deviceEntries.forEach((d) => {
            devices[d.id] = d.area_id ?? null;
          });
          devicesLoaded = true;
          if (logToUI) {
            logToUI(`   Loaded ${deviceEntries.length} devices\n`, 'debug');
          }
          processStatesIfReady();
        }

        // Handle entity registry
        if (requestType === "entity_registry" && msg.result) {
          const entityEntries = msg.result as HAEntityRegistryEntry[];
          const entitiesWithLabels = entityEntries.filter(e => e.labels && e.labels.length > 0);
          
          entityEntries.forEach((e) => {
            entities.push({
              entity_id: e.entity_id,
              device_id: e.device_id ?? null,
              name: e.name ?? null, // Store name from entity registry
              labels: e.labels ?? [], // Store labels from entity registry
            });
          });
          entitiesLoaded = true;
          if (logToUI) {
            logToUI(`   Loaded ${entityEntries.length} entities (${entitiesWithLabels.length} with labels)\n`, 'debug');
          }
          processStatesIfReady();
        }

        // Store states when received, but process only when all registries are loaded
        if (requestType === "states" && msg.result) {
          statesData = msg.result as HAStateEntry[];
          if (logToUI) {
            logToUI(`   Loaded ${statesData.length} states\n`, 'debug');
          }
          processStatesIfReady();
        }
      } catch (error) {
        if (logToUI) {
          logToUI(`   Error parsing WebSocket message: ${error instanceof Error ? error.message : String(error)}\n`, 'normal');
        }
        reject(error);
        ws.close();
      }
    };

    ws.onerror = () => {
      if (logToUI) {
        logToUI(`   WebSocket error occurred\n`, 'normal');
        logToUI(`   URL: ${haHost.replace(/\/api\/websocket$/, '')}...\n`, 'debug');
        logToUI(`   ReadyState: ${ws.readyState}\n`, 'debug');
      }
        if (logToUI) {
          logToUI(`   WebSocket error occurred\n`);
        }
      clearTimeout(connectionTimeoutId);
      reject(new Error(`WebSocket connection failed. Check if Home Assistant is accessible at ${haHost} and WebSocket is enabled.`));
      ws.close();
    };

    ws.onclose = (event) => {
      // Log closure details
      if (logToUI) {
        if (event.code === 1000) {
          logToUI(`\nWebSocket closed normally (code: 1000)\n`, 'normal');
        } else {
          logToUI(`\nWebSocket closed (code: ${event.code}${event.reason ? `, reason: ${event.reason}` : ''})\n`, 'normal');
        }
      }
      
      if (event.code !== 1000) {
        // Not a normal closure - log warning but don't fail if extraction already succeeded
        // Code 1011 is server error - usually happens when HA closes idle connections
        // This is often harmless if extraction already completed
        if (event.code === 1011) {
          if (logToUI) {
            logToUI(`   Note: Code 1011 (Server Error) often indicates HA closed an idle connection\n`, 'normal');
            logToUI(`   This is usually harmless if extraction already succeeded\n`, 'normal');
          }
        } else {
          // WebSocket closed - already logged to UI
        }
        
        // Error code 1006 means abnormal closure - connection failed before it could be established
        if (event.code === 1006 && ws.readyState === WebSocket.CLOSED) {
          if (logToUI) {
            logToUI(`   Connection failed before establishment. Possible causes:\n`, 'normal');
            logToUI(`   1. Network/firewall blocking WebSocket connections\n`, 'normal');
            logToUI(`   2. Home Assistant WebSocket endpoint not accessible\n`, 'normal');
            logToUI(`   3. Browser security policy blocking the connection\n`, 'normal');
            logToUI(`   4. Proxy or reverse proxy misconfiguration\n`, 'normal');
          }
        }
      }
    };

    // Timeout after 30 seconds
    setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) {
        reject(new Error('HA WebSocket request timeout'));
        ws.close();
      }
    }, 30000);
  });
}

