/**
 * Service domains that administer the Home Assistant install or execute
 * arbitrary code on the host, rather than controlling a device.
 *
 * Enforced in HomeBridge.call, the one funnel every transport and every caller
 * goes through, and mirrored byte for byte by services/home-relay/src/protocol.js
 * (tests/home-security.test.js fails if the two drift). A confirmation cannot
 * override it: a `shell_command.*` is remote code execution on the user's server.
 */
export const DENIED_SERVICE_DOMAINS = Object.freeze([
	'shell_command',
	'python_script',
	'hassio',
	'supervisor',
	'backup',
	'update',
	'cloud',
	'config',
	'auth',
	'command_line',
]);

/** Individual services on otherwise legitimate domains that restart, stop or reconfigure the instance. */
export const DENIED_SERVICES = Object.freeze([
	'homeassistant.restart',
	'homeassistant.stop',
	'homeassistant.check_config',
	'homeassistant.reload_all',
	'homeassistant.reload_core_config',
	'persistent_notification.create',
]);

const DENIED_DOMAIN_SET = new Set(DENIED_SERVICE_DOMAINS);
const DENIED_SERVICE_SET = new Set(DENIED_SERVICES);

/** True when `domain.service` administers the install. Case and whitespace are normalised. */
export function isDeniedService(domain, service) {
	const d = String(domain || '').trim().toLowerCase();
	const s = String(service || '').trim().toLowerCase();
	return DENIED_DOMAIN_SET.has(d) || DENIED_SERVICE_SET.has(`${d}.${s}`);
}
