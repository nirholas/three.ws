/**
 * @3dagent/lobehub-plugin
 *
 * Entry point for the three.ws LobeHub plugin.
 * Exports the main React component and configuration.
 */

export { AgentPane, type AgentPaneProps } from './AgentPane';
export { AgentBridge, type BridgeOptions } from './bridge';
export { settingsSchema, DEFAULT_API_ORIGIN, type PluginSettings } from './config-schema';

// Manifest is served separately as manifest.json; no runtime export needed.
