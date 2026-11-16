// The subEntityId a Teams notification deep link carries, as the tab receives
// it: Teams fills {subPageId} in the tab URL, which the manifest maps to ?sub=.
//   agent:<uuid>   open that agent
//   job:<id>       open a 3D job (a forge creation id or a Teams job key)
// Anything else is ignored so a hand-edited URL can never route somewhere odd.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_KEY_RE = /^teams-[0-9a-f]{40}$/;

/** `{ kind, id }` for a valid sub value, otherwise null. */
export function parseSub(value) {
	const m = /^(agent|job):(.+)$/.exec(String(value || ''));
	if (!m) return null;
	const [, kind, id] = m;
	if (kind === 'agent') return UUID_RE.test(id) ? { kind, id: id.toLowerCase() } : null;
	return UUID_RE.test(id) || JOB_KEY_RE.test(id) ? { kind, id: id.toLowerCase() } : null;
}
