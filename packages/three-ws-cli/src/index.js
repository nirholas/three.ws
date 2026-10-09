// Programmatic API for the three-ws CLI. Everything the commands do is
// available here for scripts and other tools (the desktop app, CI helpers).

export { main } from './cli.js';
export { readStore, writeStore, updateStore, resolveOrigin, mask, DEFAULT_ORIGIN } from './store.js';
export { credentialsPath, configDir, systemEnv } from './paths.js';
export { bearerFor, authorizeInBrowser, discover, pkcePair } from './oauth.js';
export { deviceLogin, startLink, pollLink } from './device.js';
export { loginKey, loginOAuth, loginDevice, logout, whoami, currentIdentity, ensureStdioKey, scopesFor } from './auth.js';
export { CLIENTS, REMOTE_CLIENTS, PRINT_CLIENT, getClient, isRemote, detectClients, readServers, writeServer, removeServer } from './clients/index.js';
export { hostedServers, stdioPackages, slugForPath, loadDirectory, loadCatalog } from './servers.js';
export { recommendedServer, modesFor, defaultMode, installUrl, connectorKey, checkConnectorKey, connectorUrl, connectorFields, verifyConnector, isPublicUrl } from './remote.js';
export { copyToClipboard } from './clipboard.js';
export { buildEntry, buildPackageEntry, proxyInvocation, usesProxy } from './entries.js';
export { listTools, post as mcpPost, parseSse } from './mcp-http.js';
export { runProxy } from './proxy.js';
export { TIERS, tierOf, isEnabled, filterTools, defaultSelection, TOOLS_HEADER } from './policy.js';
export { verifyServers, applyToClients, ensureSelections } from './configure.js';
