// Bucket copies of a Forge model that live OUTSIDE its own `forge/<client>/<id>`
// prefix, and that the row never records. A takedown (deleteCreation, the
// `forge:takedown` script) has to reach them or the model keeps serving after it
// was removed:
//
//   - the display thumbnail `forge/thumb/<id>.webp|.png` (api/_lib/forge-thumbs.js),
//   - the game-ready engine exports `forge/gameready/<h>/...` where `<h>` is the
//     first 12 hex of sha256(mesh URL) (api/forge-gameready.js), one folder per
//     mesh URL the caller sent.
//
// The export folder is keyed by whatever URL the caller supplied, so the hash is
// derived from every form that URL can take for this model: the stored URL, the
// first-party /cdn/ URL, and the raw bucket-domain URL, for the mesh, the web
// variant and the LOD variant.

import { createHash } from 'node:crypto';
import { env } from './env.js';

const GAMEREADY_ROOT = 'forge/gameready';

export function thumbKeysFor(creationId) {
	if (!creationId) return [];
	return [`forge/thumb/${creationId}.webp`, `forge/thumb/${creationId}.png`];
}

export function gameReadyHash(meshUrl) {
	return createHash('sha256').update(String(meshUrl)).digest('hex').slice(0, 12);
}

// The two first-party spellings of a bucket key: the /cdn/ proxy URL (what the
// API hands out) and the raw bucket-domain URL (what older rows stored). Built
// from env directly so a deployment without a public domain still yields /cdn/.
function urlFormsOfKey(key) {
	const encoded = key.split('/').map(encodeURIComponent).join('/');
	const out = [`${env.APP_ORIGIN}/cdn/${encoded}`];
	try {
		out.push(`${env.S3_PUBLIC_DOMAIN}/${encoded}`);
	} catch {
		// No public domain configured: only the /cdn/ spelling can exist.
	}
	return out;
}

function meshUrlForms(row) {
	const urls = new Set();
	for (const [url, key] of [
		[row.glb_url, row.glb_key],
		[row.web_glb_url, row.web_glb_key],
		[row.lod_glb_url, row.lod_glb_key],
	]) {
		if (typeof url === 'string' && url) urls.add(url);
		if (typeof key === 'string' && key.startsWith('forge/')) {
			for (const u of urlFormsOfKey(key)) urls.add(u);
		}
	}
	return [...urls];
}

// Prefixes (with a trailing slash) holding game-ready exports of this model.
export function gameReadyPrefixesFor(row) {
	return [...new Set(meshUrlForms(row).map((u) => `${GAMEREADY_ROOT}/${gameReadyHash(u)}/`))];
}
