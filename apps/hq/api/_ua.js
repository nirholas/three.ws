/**
 * Standardised User-Agent string for outgoing API requests.
 *
 * Use `UA_BOT` for APIs that accept bots (public data feeds, RSS, etc.)
 * and `UA_BROWSER` when a real-browser UA is needed to avoid blocks.
 */

export const UA_BOT = 'Mozilla/5.0 (compatible; three-ws-HQ/1.0; +https://three.ws)';

export const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
