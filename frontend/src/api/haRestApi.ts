/**
 * Home Assistant REST API client functions
 * Handles service calls and state queries
 */

import { createUILogger } from '../utils/uiLogger';

/**
 * Configuration for Home Assistant REST API
 */
export interface HARestApiConfig {
  baseUrl: string;
  accessToken: string;
}

/**
 * Helper function to normalize base URL for REST API
 * Converts WebSocket URLs to HTTP/HTTPS and removes WebSocket paths
 */
function normalizeRestBaseUrl(baseUrl: string): string {
  let restBaseUrl = baseUrl.replace(/^ws:\/\//, 'http://');
  if (!restBaseUrl.startsWith('http://') && !restBaseUrl.startsWith('https://')) {
    restBaseUrl = `http://${restBaseUrl}`;
  }
  // Remove /api/websocket if present
  restBaseUrl = restBaseUrl.replace(/\/api\/websocket$/, '');
  // Remove trailing slash to prevent double slashes in URLs
  restBaseUrl = restBaseUrl.replace(/\/$/, '');
  return restBaseUrl;
}

/**
 * Execute Home Assistant service call
 * Transforms Gemini function call format to HA REST API format
 * @param config Home Assistant configuration (baseUrl and accessToken)
 * @param args Service call arguments (domain, service, target, service_data)
 * @param uiElement Optional UI element for logging
 * @param sequenceNum Optional sequence number for logging (if not provided, will be generated)
 * @returns The sequence number used for this call
 */
export async function executeHAServiceCall(
  config: HARestApiConfig,
  args: {
    domain: string;
    service: string;
    target: { entity_id: string };
    service_data?: any;
  },
  uiElement?: HTMLTextAreaElement,
  sequenceNum?: number
): Promise<number> {
  const { domain, service, target, service_data } = args;
  
  if (!domain || !service || !target) {
    throw new Error('Missing required parameters: domain, service, and target are required');
  }
  
  if (!config.baseUrl || !config.accessToken) {
    throw new Error('Home Assistant configuration missing (baseUrl or accessToken)');
  }
  
  // Build the service URL
  const restBaseUrl = normalizeRestBaseUrl(config.baseUrl);
  const serviceUrl = `${restBaseUrl}/api/services/${domain}/${service}`;
  
  // Build the request body
  const entityId = target.entity_id;
  if (!entityId) {
    throw new Error('target.entity_id is required');
  }
  
  const requestBody: any = {
    entity_id: entityId
  };
  
  // Merge service_data if provided
  if (service_data && typeof service_data === 'object') {
    Object.assign(requestBody, service_data);
  }
  
  // Log execution attempt to UI
  const logToUI = createUILogger(uiElement);
  
  // Use provided sequence number or generate a placeholder (caller should manage sequence)
  const seq = sequenceNum !== undefined ? sequenceNum : 0;
  const timestamp = new Date().toISOString();
  logToUI(`\nAPP → HA [#${seq}]\n`);
  logToUI(`Executing HA service call: ${domain}.${service}\n`);
  logToUI(`   Entity: ${entityId}\n`);
  logToUI(`   REST API URL: ${serviceUrl}\n`);
  logToUI(`   Method: POST\n`);
  logToUI(`   Headers:\n`);
  logToUI(`     Authorization: Bearer ${config.accessToken.substring(0, 10)}...${config.accessToken.substring(config.accessToken.length - 4)}\n`);
  logToUI(`     Content-Type: application/json\n`);
  logToUI(`   Request Body: ${JSON.stringify(requestBody, null, 2)}\n`);
  if (service_data && Object.keys(service_data).length > 0) {
    logToUI(`   Service data: ${JSON.stringify(service_data)}\n`);
  }
  
  console.log(`Executing HA service call: ${domain}.${service}`, {
    url: serviceUrl,
    body: requestBody
  });
  
  try {
    const response = await fetch(serviceUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    const responseTimestamp = new Date().toISOString();
    logToUI(`\nHA → APP [#${seq}]\n`);
    logToUI(`   Response Status: ${response.status} ${response.statusText}\n`);
    
    if (!response.ok) {
      const errorText = await response.text();
      const errorMsg = `HA API error (${response.status}): ${errorText}`;
      logToUI(`Failed: ${errorMsg}\n`);
      logToUI(`   Response Body: ${errorText}\n`);
      throw new Error(errorMsg);
    }
    
    const result = await response.json();
    console.log('HA service call successful:', result);
    logToUI(`Successfully executed ${domain}.${service} on ${entityId}\n`);
    logToUI(`   Response Body: ${JSON.stringify(result, null, 2)}\n`);
    
    return seq;
  } catch (error: any) {
    console.error('HA service call failed:', error);
    const errorTimestamp = new Date().toISOString();
    logToUI(`\nERROR\n`);
    logToUI(`   Error: ${error.message || String(error)}\n`);
    throw error;
  }
}

/**
 * Query Home Assistant entity state
 * Fetches current state of an entity from HA REST API
 * @param config Home Assistant configuration (baseUrl and accessToken)
 * @param entityId The entity ID to query
 * @param uiElement Optional UI element for logging
 * @param sequenceNum Optional sequence number for logging
 * @returns The entity state object
 */
export async function getHAEntityState(
  config: HARestApiConfig,
  entityId: string,
  uiElement?: HTMLTextAreaElement,
  sequenceNum?: number
): Promise<any> {
  if (!config.baseUrl || !config.accessToken) {
    throw new Error('Home Assistant configuration missing (baseUrl or accessToken)');
  }
  
  // Build the state URL
  const restBaseUrl = normalizeRestBaseUrl(config.baseUrl);
  
  // URL encode the entity_id to handle special characters
  const encodedEntityId = encodeURIComponent(entityId);
  const stateUrl = `${restBaseUrl}/api/states/${encodedEntityId}`;
  
  // Log query attempt to UI
  const logToUI = createUILogger(uiElement);
  
  // Use provided sequence number or generate a placeholder
  const seq = sequenceNum !== undefined ? sequenceNum : 0;
  const timestamp = new Date().toISOString();
  logToUI(`\nAPP → HA [#${seq}]\n`);
  logToUI(`Querying HA entity state: ${entityId}\n`);
  logToUI(`   Method: GET\n`);
  logToUI(`   URL: ${stateUrl}\n`);
  
  // Reduced console logging - details are logged to UI debug panel
  // console.log(`Querying HA entity state: ${entityId}`, { url: stateUrl });
  
  try {
    const response = await fetch(stateUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `HA API error (${response.status}): ${errorText}`;
      
      // Provide more helpful error messages
      if (response.status === 404) {
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message === 'Entity not found.') {
            errorMsg = `Entity not found: ${entityId}. Please check that this entity exists in Home Assistant. Available entities can be found in the HA configuration.`;
          }
        } catch (e) {
          // If parsing fails, use the original error
        }
      }
      
      const errorTimestamp = new Date().toISOString();
      logToUI(`\nERROR\n`);
      logToUI(`   ${errorMsg}\n`);
      throw new Error(errorMsg);
    }
    
    const state = await response.json();
    // Reduced console logging - success details are logged to UI debug panel
    // console.log('HA state query successful:', state);
    const responseTimestamp = new Date().toISOString();
    logToUI(`\nHA → APP [#${seq}]\n`);
    logToUI(`State for ${entityId}: ${state.state}\n`);
    if (state.attributes && Object.keys(state.attributes).length > 0) {
      // Format attributes nicely
      const attrs = Object.entries(state.attributes)
        .map(([key, value]) => `     ${key}: ${JSON.stringify(value)}`)
        .join('\n');
      logToUI(`   Attributes:\n${attrs}\n`);
    }
    return state;
  } catch (error: any) {
    console.error('❌ HA state query failed:', error);
    logToUI(`❌ [${timestamp}] Error: ${error.message || String(error)}\n`);
    throw error;
  }
}

