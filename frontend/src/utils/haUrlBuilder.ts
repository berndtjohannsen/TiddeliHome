/**
 * Home Assistant URL building utilities
 */

/**
 * Build Home Assistant WebSocket URL from base URL
 * Converts HTTP/HTTPS URLs to WebSocket URLs and ensures proper format
 * @param baseUrl The Home Assistant base URL (e.g., "https://192.168.1.20:8123")
 * @returns The WebSocket URL (e.g., "wss://192.168.1.20:8123/api/websocket")
 */
export function getHAWebSocketUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    // Check if we should use secure WebSocket
    // If baseUrl is https, use wss. Otherwise try ws first, but Home Assistant might require wss even for http
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    // Home Assistant WebSocket is always at /api/websocket
    const wsUrl = `${protocol}//${url.host}/api/websocket`;
    console.log('Constructed WebSocket URL:', wsUrl, 'from baseUrl:', baseUrl);
    return wsUrl;
  } catch (error) {
    console.error('Error constructing WebSocket URL:', error, 'baseUrl:', baseUrl);
    throw new Error(`Invalid baseUrl: ${baseUrl}`);
  }
}

