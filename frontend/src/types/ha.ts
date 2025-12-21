/**
 * Home Assistant entity structure (internal format)
 */
export interface HAEntity {
  entity_id: string;
  name: string;
  area: string;
  domain: string;
  capabilities?: {
    // For lights: supported features
    supports_brightness?: boolean;
    supports_color?: boolean;
    supports_color_temp?: boolean;
    // Add other domain-specific capabilities as needed
  };
}

/**
 * Custom Home Assistant configuration structure
 * This is the condensed format sent to AI
 */
export interface CustomHAConfig {
  entities: HAEntity[];
}

/**
 * Home Assistant WebSocket message types
 */
export interface HAWebSocketMessage {
  id?: number;
  type: string;
  access_token?: string;
  result?: any;
}

/**
 * Home Assistant area registry entry
 */
export interface HAAreaRegistryEntry {
  area_id: string;
  name: string;
  aliases?: string[];
  floor_id?: string | null;
  humidity_entity_id?: string | null;
  icon?: string | null;
}

/**
 * Home Assistant device registry entry
 */
export interface HADeviceRegistryEntry {
  id: string;
  area_id: string | null;
}

/**
 * Home Assistant entity registry entry
 */
export interface HAEntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  name?: string | null;
  original_name?: string;
  labels?: string[]; // Array of label IDs
}

/**
 * Home Assistant state entry (from get_states)
 */
export interface HAStateEntry {
  entity_id: string;
  attributes: {
    friendly_name?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

