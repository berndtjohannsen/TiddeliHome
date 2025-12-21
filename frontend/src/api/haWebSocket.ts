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
  logToUI?: (message: string) => void,
  domains?: string[],
  allowAnyDomain?: boolean,
  connectionTimeout?: number
): Promise<HAEntitiesResult> {
  return new Promise((resolve, reject) => {
    console.log('fetchHAEntities called with:');
    console.log('  haHost:', haHost);
    console.log('  haToken type:', typeof haToken);
    console.log('  haToken length:', haToken?.length || 0);
    console.log('  haToken first 20 chars:', haToken ? haToken.substring(0, 20) : 'MISSING');
    console.log('  haToken last 20 chars:', haToken && haToken.length > 20 ? haToken.substring(haToken.length - 20) : 'MISSING');
    console.log('  haToken full (for debugging):', haToken);
    
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
    console.log('WebSocket created, initial readyState:', ws.readyState);
    
    if (logToUI) {
      logToUI(`   WebSocket state: Connecting...\n`);
    }
    
    // Add connection timeout
    const timeoutMs = connectionTimeout || 5000;
    const connectionTimeoutId = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket connection timeout');
        if (logToUI) {
          logToUI(`   ⚠️ Connection timeout\n`);
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
      // If allowAnyDomain is true, we don't filter by domain (but still respect labels)
      const shouldFilterByDomain = !allowAnyDomain && domains && domains.length > 0;
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
        
        // Check if entity should be included
        // If allowAnyDomain is true, include all domains (except those excluded by labels)
        // Otherwise, filter by domain whitelist
        const hasAIUseLabel = entityLabels.some(label => 
          normalizeLabel(label) === normalizeLabel("use-by-ai")
        );
        
        let isIncludedDomain = false;
        if (shouldFilterByDomain) {
          // Check if domain is in the allowed list
          isIncludedDomain = includedDomains.includes(domain);
        } else {
          // If allowAnyDomain is true, include all domains (label exclusions still apply)
          isIncludedDomain = true;
        }
        
        // Special handling: entities with "use-by-ai" label are always included
        // (even if their domain is not in the domains list and allowAnyDomain is false)
        // This allows selective inclusion of entities from domains not in the main list
        // (e.g., specific sensors or switches when their domain is excluded)
        
        // Debug logging for entities with use-by-ai label that aren't in the domain list
        if (hasAIUseLabel && !isIncludedDomain) {
          console.log(`Entity ${state.entity_id} (${domain}) with use-by-ai label:`, {
            labels: entityLabels,
            hasAIUseLabel,
            isIncludedDomain,
            shouldFilterByDomain,
            willInclude: true
          });
        }
        
        // Exclude if domain is not in allowed list (unless it has use-by-ai label)
        if (shouldFilterByDomain && !isIncludedDomain && !hasAIUseLabel) {
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
        
        // Debug logging for name resolution
        if (state.entity_id.includes('ikea') || state.entity_id.includes('fönsterlampa')) {
          console.log(`Name resolution for ${state.entity_id}:`, {
            registryName,
            stateFriendlyName,
            finalName,
            registryEntry
          });
        }

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
        
        // Debug logging for entities with use-by-ai label being added (when not in domain list)
        if (hasAIUseLabel && !isIncludedDomain) {
          console.log(`Adding ${domain} entity to result (use-by-ai label):`, entityToAdd);
        }
        
        result.push(entityToAdd);
      });

      console.log(`Built custom config with ${result.length} entities`);
      console.log(`Areas available: ${Object.keys(areas).length}, Devices: ${Object.keys(devices).length}`);
      console.log(`Sample area mapping:`, Object.entries(areas).slice(0, 3));
      
      // Filter states to only include entities that are in the result (same filtering logic)
      const entityIdsInResult = new Set(result.map(e => e.entity_id));
      const filteredStates = (statesData || []).filter(state => entityIdsInResult.has(state.entity_id));
      
      // Close the WebSocket connection cleanly after extraction completes
      // Use close code 1000 (Normal Closure) to indicate intentional closure
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Config extraction completed');
          if (logToUI) {
            logToUI(`   Closing WebSocket connection (extraction complete)\n`);
          }
        }
      } catch (closeError) {
        // Log but don't fail - we already have the data
        console.warn('Error closing WebSocket after extraction:', closeError);
      }
      
      resolve({ 
        config: { entities: result },
        states: filteredStates // Return states separately, not mixed with config
      });
    }

    ws.onopen = () => {
      console.log('HA WebSocket connected, authenticating...');
      if (logToUI) {
        logToUI(`   WebSocket state: Connected ✅\n`);
        logToUI(`   Sending auth message...\n`);
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
            logToUI(`   Received: ${msg.type}\n`);
          } else if (msg.type === 'result') {
            const requestType = pendingRequests.get(msg.id!);
            if (requestType) {
              const truncatedType = requestType.length > 40 ? requestType.substring(0, 37) + '...' : requestType;
              logToUI(`   Received: ${truncatedType} result (${msg.success ? 'success' : 'error'})\n`);
            }
          }
        }

        if (msg.type === "auth_ok") {
          console.log('HA WebSocket authenticated, fetching registries...');
          
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
          console.log('Area registry data:', areaEntries);
          areaEntries.forEach((a) => {
            areas[a.area_id] = a.name;
          });
          areasLoaded = true;
          console.log(`Loaded ${areaEntries.length} areas:`, areas);
          processStatesIfReady();
        }

        // Handle device registry
        if (requestType === "device_registry" && msg.result) {
          const deviceEntries = msg.result as HADeviceRegistryEntry[];
          console.log('Device registry data (first 5):', deviceEntries.slice(0, 5));
          deviceEntries.forEach((d) => {
            devices[d.id] = d.area_id ?? null;
          });
          devicesLoaded = true;
          console.log(`Loaded ${deviceEntries.length} devices`);
          console.log('Device to area mapping (sample):', Object.entries(devices).slice(0, 5));
          processStatesIfReady();
        }

        // Handle entity registry
        if (requestType === "entity_registry" && msg.result) {
          const entityEntries = msg.result as HAEntityRegistryEntry[];
          console.log('Entity registry data (first 5):', entityEntries.slice(0, 5));
          
          // Debug: Log entities with labels
          const entitiesWithLabels = entityEntries.filter(e => e.labels && e.labels.length > 0);
          console.log(`Found ${entitiesWithLabels.length} entities with labels:`, entitiesWithLabels.map(e => ({
            entity_id: e.entity_id,
            labels: e.labels
          })));
          
          entityEntries.forEach((e) => {
            entities.push({
              entity_id: e.entity_id,
              device_id: e.device_id ?? null,
              name: e.name ?? null, // Store name from entity registry
              labels: e.labels ?? [], // Store labels from entity registry
            });
          });
          entitiesLoaded = true;
          console.log(`Loaded ${entityEntries.length} entities from registry`);
          console.log('Entity to device mapping (sample):', entities.slice(0, 5));
          processStatesIfReady();
        }

        // Store states when received, but process only when all registries are loaded
        if (requestType === "states" && msg.result) {
          statesData = msg.result as HAStateEntry[];
          console.log(`Loaded ${statesData.length} states`);
          console.log('States data (first 3):', statesData.slice(0, 3).map(s => ({
            entity_id: s.entity_id,
            friendly_name: s.attributes?.friendly_name,
            has_device_id: entities.find(e => e.entity_id === s.entity_id)?.device_id !== null
          })));
          processStatesIfReady();
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        reject(error);
        ws.close();
      }
    };

    ws.onerror = (error) => {
      console.error('HA WebSocket error:', error);
      console.error('WebSocket URL attempted:', haHost);
      console.error('WebSocket readyState:', ws.readyState);
      if (logToUI) {
        logToUI(`   ⚠️ WebSocket error occurred\n`);
      }
      clearTimeout(connectionTimeoutId);
      reject(new Error(`WebSocket connection failed. Check if Home Assistant is accessible at ${haHost} and WebSocket is enabled.`));
      ws.close();
    };

    ws.onclose = (event) => {
      // Log closure details
      if (logToUI) {
        if (event.code === 1000) {
          logToUI(`   WebSocket closed normally (code: 1000)\n`);
        } else {
          logToUI(`   WebSocket closed (code: ${event.code}${event.reason ? `, reason: ${event.reason}` : ''})\n`);
        }
      }
      
      if (event.code !== 1000) {
        // Not a normal closure - log warning but don't fail if extraction already succeeded
        const closeInfo = {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          url: haHost
        };
        
        // Code 1011 is server error - usually happens when HA closes idle connections
        // This is often harmless if extraction already completed
        if (event.code === 1011) {
          console.warn('HA WebSocket closed with server error (1011) - this may occur after extraction completes:', closeInfo);
          if (logToUI) {
            logToUI(`   ⚠️ Note: Code 1011 (Server Error) often indicates HA closed an idle connection\n`);
            logToUI(`   This is usually harmless if extraction already succeeded\n`);
          }
        } else {
          console.warn('HA WebSocket closed unexpectedly:', closeInfo);
        }
        
        // Error code 1006 means abnormal closure - connection failed before it could be established
        if (event.code === 1006 && ws.readyState === WebSocket.CLOSED) {
          console.error('WebSocket connection failed before establishment. Possible causes:');
          console.error('1. Network/firewall blocking WebSocket connections');
          console.error('2. Home Assistant WebSocket endpoint not accessible');
          console.error('3. Browser security policy blocking the connection');
          console.error('4. Proxy or reverse proxy misconfiguration');
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

