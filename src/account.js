// Lightweight client helpers for talking to the three.ws backend from the viewer.
// Keeps the UI code in app.js/avatar-creator.js clean.

import { identifyUser, resetIdentity } from './analytics.js';
import { apiFetch, consumeCsrfToken } from './api.js';
import { log } from './shared/log.js';

// Re-export for back-compat — many modules still `import { apiFetch } from
// './account.js'`. New code should import from './api.js' directly.
export { apiFetch };

const API = ''; // same origin

// Optimistic auth hint — non-authoritative, used only for first-paint gating
// on the viewer. The real session cookie is HttpOnly so we can't read it
// synchronously; this hint lets us avoid a visible flash between "pending"
// and the resolved state for returning users. Always revalidated by getMe().
const AUTH_HINT_KEY = '3dagent:auth-hint';
const AUTH_HINT_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7d

export function readAuthHint() {
	try {
		const raw = localStorage.getItem(AUTH_HINT_KEY);
		if (!raw) return null;
		const { authed, ts } = JSON.parse(raw);
		if (!ts || Date.now() - ts > AUTH_HINT_TTL_MS) return null;
		return authed ? 'true' : 'false';
	} catch {
		return null;
	}
}

function writeAuthHint(authed) {
	try {
		localStorage.setItem(AUTH_HINT_KEY, JSON.stringify({ authed: !!authed, ts: Date.now() }));
	} catch {
		/* quota or disabled storage */
	}
}

export function clearAuthHint() {
	try {
		localStorage.removeItem(AUTH_HINT_KEY);
	} catch {
		/* ignore */
	}
}

export async function getMe() {
	// /api/auth/me 401s for anonymous visitors by design — handle in place.
	const res = await apiFetch(`${API}/api/auth/me`, { allowAnonymous: true });
	if (res.status === 401) {
		writeAuthHint(false);
		resetIdentity();
		return null;
	}
	if (!res.ok) throw new Error(`auth/me failed: ${res.status}`);
	const user = (await res.json()).user;
	writeAuthHint(!!user);
	if (user) identifyUser(user);
	return user;
}

// Uploads a GLB to our R2 bucket and creates the avatar record.
// `source` may be a Blob (from CharacterStudio postMessage) or a URL string.
//
// Pass `opts.onProgress(pct)` to receive 0..100 upload-percentage callbacks
// (R2 PUT only — presign + commit are negligible by comparison).
//
// Errors carry a `.stage` ('fetch' | 'canonicalize' | 'presign' | 'upload' |
// 'commit') and may carry a `.code` for the UI to act on:
//   - 'upload_blocked'  — XHR completed with status 0 (CORS preflight or
//                         a network drop between the browser and R2).
//   - 'upload_failed'   — R2 returned a non-2xx (auth/signature/checksum).
//   - 'not_signed_in'   — propagated from apiFetch when the cookie is gone.
//
// No explicit auth pre-check: `presign` requires a session, so if the cookie
// is missing or expired apiFetch redirects to /login (and throws with
// err.redirected = true). Callers that want post-login resume should set
// their sentinel BEFORE calling — apiFetch's redirect happens synchronously.
export async function saveRemoteGlbToAccount(source, meta = {}, opts = {}) {
	const { onProgress, signal } = opts;
	const throwIfAborted = () => {
		if (signal?.aborted) {
			throw stageError('upload', 'Upload aborted', { code: 'upload_aborted' });
		}
	};
	throwIfAborted();

	// Preflight the session ourselves so the caller can set up post-login
	// resume state *before* any redirect. apiFetch's built-in 401 handler
	// would jump to /login synchronously, leaving no window to stash a
	// sentinel — we'd lose the staged blob across the round-trip.
	// Tolerate transient probe failures: a 5xx on /api/auth/me (Vercel cold
	// start, dev-proxy hiccup) shouldn't block the upload. If we're truly
	// signed out, the presign call below will 401 and apiFetch redirects.
	let me;
	try {
		me = await getMe();
	} catch (err) {
		log.warn('[account] getMe probe failed, proceeding optimistically:', err?.message);
		me = { id: null, optimistic: true };
	}
	if (me === null) throw stageError('auth', 'Not signed in', { code: 'not_signed_in' });

	// `serverFetched` is set when we couldn't pull the GLB in the browser and let
	// the API fetch it instead — in that branch the bytes already live in R2, so
	// we skip the local canonicalize/presign/upload steps and commit directly.
	let blob = null;
	let serverFetched = null;
	if (source instanceof Blob) {
		blob = source;
	} else {
		try {
			const resp = await fetch(source, { mode: 'cors' });
			if (!resp.ok)
				throw stageError('fetch', `failed to fetch source GLB: ${resp.status}`);
			blob = await resp.blob();
		} catch (err) {
			if (err.stage) throw err;
			// Most avatar CDNs (RPM CloudFront, Arweave, arbitrary storage) serve
			// no CORS headers, so a browser fetch is blocked. Fall back to a
			// server-side fetch: the API pulls the file for us — no CORS, no SSRF
			// exposure — and stores it directly. This is the normal URL-import path.
			log.warn('[account] client-side GLB fetch blocked; fetching via server', err?.message);
			onProgress?.(0);
			try {
				serverFetched = await fetchRemoteViaProxy(String(source), { onProgress, signal });
			} catch (proxyErr) {
				proxyErr.stage = proxyErr.stage || 'fetch';
				throw proxyErr;
			}
		}
	}

	let retargetedBoneCount = 0;
	let storageKey = null;
	let size;
	let contentType;
	let checksum;

	if (serverFetched) {
		storageKey = serverFetched.storage_key;
		size = serverFetched.size_bytes;
		contentType = serverFetched.content_type || 'model/gltf-binary';
		checksum = serverFetched.checksum_sha256;
		onProgress?.(100);
	} else {
		// Canonicalize humanoid bone names before upload so the pre-baked Mixamo
		// animation library plays out of the box. Non-fatal — if the buffer isn't
		// a valid GLB or the rig isn't humanoid, fall through with the original.
		try {
			const { canonicalizeGLBBones } = await import('./glb-canonicalize.js');
			const buf = await blob.arrayBuffer();
			const result = canonicalizeGLBBones(buf);
			if (result.renamed > 0 || result.orientationCorrected) {
				blob = new Blob([result.buffer], { type: 'model/gltf-binary' });
				retargetedBoneCount = result.renamed;
			}
		} catch (err) {
			log.warn('[account] canonicalize failed; uploading original', err);
		}

		size = blob.size;
		contentType = blob.type || 'model/gltf-binary';
		checksum = await sha256Hex(blob);

		// Presign + direct browser→R2 PUT is the happy path: cheapest, doesn't
		// route bytes through our function. When the deploy origin isn't in the
		// bucket CORS allowlist (ephemeral Codespaces hosts, branch deploys with a
		// new hostname), the preflight fails. In that case fall through to the
		// server-side proxy upload so the save always completes regardless of
		// bucket CORS state.
		let presign = null;
		try {
			presign = await postJson('/api/avatars/presign', {
				size_bytes: size,
				content_type: contentType,
				checksum_sha256: checksum,
			});
		} catch (err) {
			err.stage = err.stage || 'presign';
			throw err;
		}

		try {
			await putToR2({
				url: presign.upload_url,
				blob,
				contentType,
				onProgress,
				signal,
			});
			storageKey = presign.storage_key;
		} catch (err) {
			if (err.code === 'upload_aborted') throw err;
			if (err.code !== 'upload_blocked') {
				err.stage = err.stage || 'upload';
				throw err;
			}
			log.warn('[account] direct R2 PUT blocked; retrying via server proxy');
			// Reset progress so the proxy attempt restarts visibly at 0% rather than
			// looking stuck at whatever the direct PUT reached before failing.
			onProgress?.(0);
			try {
				const proxied = await uploadViaProxy({
					blob,
					contentType,
					checksum,
					onProgress,
					signal,
				});
				storageKey = proxied.storage_key;
			} catch (proxyErr) {
				proxyErr.stage = proxyErr.stage || 'upload';
				throw proxyErr;
			}
		}
	}

	const sourceMeta = {
		...(meta.source_meta ||
			(typeof source === 'string' ? { source_url: source } : { generator: 'characterstudio' })),
		...(retargetedBoneCount > 0 ? { retargeted_bones: retargetedBoneCount } : {}),
	};

	let created;
	try {
		created = await postJson('/api/avatars', {
			storage_key: storageKey,
			size_bytes: size,
			content_type: contentType,
			checksum_sha256: checksum,
			name: meta.name || deriveAvatarName(source, checksum),
			description: meta.description,
			visibility: meta.visibility || 'public',
			tags: meta.tags || [],
			source: meta.source || 'upload',
			source_meta: sourceMeta,
		});
	} catch (err) {
		err.stage = err.stage || 'commit';
		throw err;
	}
	const avatar = created.avatar;

	// Fire-and-forget thumbnail + auto-tag pipeline. Doesn't block the caller.
	// Renders the GLB offscreen in the thumbnail rest pose, captures a JPEG
	// poster, uploads to R2, and calls Claude Haiku for tags + description.
	captureAndTagAvatar(avatar.id, storageKey).catch((err) => {
		log.warn('[account] thumbnail/auto-tag pipeline failed silently', err?.message);
	});

	// USDZ + half-body companion generation is opt-in (the demo page at
	// /demos/usdz-ar passes generateCompanions:true). The live /create flow
	// stays untouched — those derivations run client-side and add several
	// seconds of CPU on every save, so they don't ship to all users yet.
	if (meta.generateCompanions && blob) {
		generateAndSaveCompanions(avatar.id, blob).catch((err) => {
			log.warn('[account] usdz/halfbody pipeline failed silently', err?.message);
		});
	}

	return avatar;
}

export async function generateAndSaveCompanions(avatarId, glbBlob) {
	const { glbBlobToUsdzBlob, glbBlobToHalfBodyBlob, glbBlobToArkitReport } = await import(
		'./usdz-pipeline.js'
	);

	// ARKit-52 conformance check — runs in the background, dispatches a
	// `three-ws:arkit-report` CustomEvent so pages can show coverage to the
	// user. Independent of usdz / halfbody passes so a failure here doesn't
	// block them.
	(async () => {
		let report;
		try {
			report = await glbBlobToArkitReport(glbBlob);
		} catch (err) {
			log.warn('[account] arkit report failed:', err?.message);
			return;
		}
		log.info(
			`[account] avatar ${avatarId} ARKit-52 coverage: ${Math.round(report.coverage * 100)}% (${report.implemented.length}/52)`,
		);
		try {
			document.dispatchEvent(
				new CustomEvent('three-ws:arkit-report', {
					detail: { avatarId, ...report },
				}),
			);
		} catch (_) {}
	})();

	// USDZ companion for iOS Quick Look. Independent of the half-body pass so
	// a failure in one doesn't poison the other.
	(async () => {
		let usdzBlob;
		try {
			// Pre-bake the animated USDZ so the avatar idles in AR straight from
			// storage; degrade to the static bake if it can't be animated.
			try {
				const { glbBlobToAnimatedUsdzBlob, DEFAULT_AR_ANIMATION } = await import(
					'./usdz-animated.js'
				);
				const animResp = await fetch(DEFAULT_AR_ANIMATION);
				if (!animResp.ok) throw new Error(`animation fetch ${animResp.status}`);
				const animationGlbBlob = await animResp.blob();
				usdzBlob = await glbBlobToAnimatedUsdzBlob(glbBlob, { animationGlbBlob });
			} catch (animErr) {
				log.warn('[account] animated usdz unavailable, using static:', animErr?.message);
				usdzBlob = await glbBlobToUsdzBlob(glbBlob);
			}
		} catch (err) {
			log.warn('[account] usdz export failed:', err?.message);
			return;
		}
		try {
			const pre = await postJson('/api/avatars/presign-usdz', {
				avatar_id: avatarId,
				size_bytes: usdzBlob.size,
			});
			const put = await fetch(pre.upload_url, {
				method: 'PUT',
				headers: { 'content-type': 'model/vnd.usdz+zip' },
				body: usdzBlob,
			});
			if (!put.ok) throw new Error(`R2 usdz upload failed: ${put.status}`);
			await apiFetch(`/api/avatars/${avatarId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ usdz_key: pre.usdz_key }),
			});
		} catch (err) {
			log.warn('[account] usdz upload/patch failed:', err?.message);
		}
	})();

	// Half-body variant for VR. Optional — not every avatar has the recognizable
	// lower-body bones we need to strip, in which case the generator throws and
	// we silently skip.
	(async () => {
		let halfBlob;
		try {
			halfBlob = await glbBlobToHalfBodyBlob(glbBlob);
		} catch (err) {
			// Expected when an avatar has no leg bones (busts, robots, non-humans).
			return;
		}
		try {
			const pre = await postJson('/api/avatars/presign-halfbody', {
				avatar_id: avatarId,
				size_bytes: halfBlob.size,
			});
			const put = await fetch(pre.upload_url, {
				method: 'PUT',
				headers: { 'content-type': 'model/gltf-binary' },
				body: halfBlob,
			});
			if (!put.ok) throw new Error(`R2 halfbody upload failed: ${put.status}`);
			await apiFetch(`/api/avatars/${avatarId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ halfbody_key: pre.halfbody_key }),
			});
		} catch (err) {
			log.warn('[account] halfbody upload/patch failed:', err?.message);
		}
	})();
}

async function captureAndTagAvatar(avatarId, storageKey) {
	// Resolve the public GLB URL from the storage key.
	const glbUrl = storageKey.startsWith('http')
		? storageKey
		: `${location.origin}/api/avatars/${avatarId}?url=1`;

	// We need the actual R2 public URL. Get it from the avatar record.
	let publicGlb;
	try {
		const r = await apiFetch(`/api/avatars/${avatarId}`);
		if (!r.ok) return;
		const j = await r.json();
		publicGlb = j.avatar?.url || j.avatar?.model_url;
		if (!publicGlb) return;
	} catch { return; }

	// Render the poster offscreen with the shared three.js renderer, which stands
	// a humanoid in the thumbnail rest pose first. The hidden <model-viewer> this
	// replaced captured the raw bind pose, so every saved avatar's gallery card
	// showed a T-pose, and being the slower of the two /create captures it usually
	// landed last and overwrote the posed one.
	const glbRes = await fetch(publicGlb);
	if (!glbRes.ok) throw new Error(`thumbnail source fetch failed: ${glbRes.status}`);
	const { glbFileToThumbnail } = await import('./erc8004/thumbnail.js');
	const thumbBlob = await glbFileToThumbnail(await glbRes.blob(), {
		size: 512,
		mimeType: 'image/jpeg',
		quality: 0.82,
	});
	if (!thumbBlob || thumbBlob.size < 500) return;

	// Get a presigned upload URL for the thumbnail.
	const presignRes = await postJson('/api/avatars/presign-thumbnail', {
		avatar_id: avatarId,
		size_bytes: thumbBlob.size,
	});

	// Upload the JPEG to R2.
	const putRes = await fetch(presignRes.upload_url, {
		method: 'PUT',
		headers: { 'content-type': 'image/jpeg' },
		body: thumbBlob,
	});
	if (!putRes.ok) throw new Error(`thumbnail R2 upload failed: ${putRes.status}`);

	// Patch the avatar to store the thumbnail_key, then auto-tag via Claude vision.
	await apiFetch(`/api/avatars/${avatarId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ thumbnail_key: presignRes.thumb_key }),
	});

	// Auto-tag (non-fatal — Claude vision call).
	await postJson('/api/avatars/auto-tag', {
		avatar_id: avatarId,
		thumb_key: presignRes.thumb_key,
	});
}

// PUT a Blob to a presigned R2 URL via XHR so the caller can render real
// upload progress and so failures can be distinguished by cause:
//   - status 0       → preflight blocked, network drop, or signed-URL host
//                      unreachable. Almost always CORS in practice.
//   - 2xx            → success.
//   - non-2xx        → R2 returned an error (signature mismatch, expired URL,
//                      checksum failure). Body is text/xml; surface inline.
//
// onProgress is called with an integer 0..100. fetch() has no upload-progress
// hook in any browser, so XHR is the only path that works today.
function putToR2({ url, blob, contentType, onProgress, signal }) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(stageError('upload', 'Upload aborted', { code: 'upload_aborted' }));
			return;
		}
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', url, true);
		xhr.setRequestHeader('content-type', contentType);
		if (onProgress) {
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) {
					onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
				}
			};
			xhr.upload.onload = () => onProgress(100);
		}
		const onAbort = () => xhr.abort();
		if (signal) signal.addEventListener('abort', onAbort, { once: true });
		const cleanup = () => signal?.removeEventListener('abort', onAbort);
		xhr.onload = () => {
			cleanup();
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve();
				return;
			}
			reject(
				stageError(
					'upload',
					`R2 upload failed: ${xhr.status} ${xhr.statusText || ''}`.trim(),
					{ code: 'upload_failed', status: xhr.status },
				),
			);
		};
		xhr.onerror = () => {
			cleanup();
			// status 0 ⇒ no HTTP response. CORS preflight failure is by far the
			// most common cause; surface a hint the UI can render.
			reject(
				stageError(
					'upload',
					'Upload was blocked before reaching R2 (likely a CORS or network issue).',
					{ code: 'upload_blocked' },
				),
			);
		};
		xhr.onabort = () => {
			cleanup();
			reject(stageError('upload', 'Upload aborted', { code: 'upload_aborted' }));
		};
		xhr.send(blob);
	});
}

// Server-side upload fallback used when a direct R2 PUT is blocked (CORS or
// network). Streams the blob to /api/avatars/upload, which PUTs it to R2
// using server-side credentials. Same auth + quota path as presign — we get
// back the storage_key to commit with /api/avatars.
//
// Uses XHR (not fetch) so onProgress works in every browser. CSRF is fetched
// from the same single-use endpoint apiFetch uses; we don't go through
// apiFetch because it can't propagate upload progress.
async function uploadViaProxy({ blob, contentType, checksum, onProgress, signal }) {
	if (signal?.aborted) {
		throw stageError('upload', 'Upload aborted', { code: 'upload_aborted' });
	}
	const csrf = await consumeCsrfToken();
	const qs = new URLSearchParams({ content_type: contentType });
	if (checksum) qs.set('sha256', checksum);
	const url = `${API}/api/avatars/upload?${qs.toString()}`;

	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', url, true);
		xhr.withCredentials = true;
		xhr.setRequestHeader('content-type', contentType);
		if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
		if (onProgress) {
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) {
					onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
				}
			};
			xhr.upload.onload = () => onProgress(100);
		}
		const onAbort = () => xhr.abort();
		if (signal) signal.addEventListener('abort', onAbort, { once: true });
		const cleanup = () => signal?.removeEventListener('abort', onAbort);
		xhr.onload = () => {
			cleanup();
			if (xhr.status === 401) {
				redirectToLogin();
				reject(stageError('upload', 'session expired', { status: 401, code: 'not_signed_in' }));
				return;
			}
			let data = null;
			try {
				data = JSON.parse(xhr.responseText);
			} catch {
				/* non-JSON body */
			}
			if (xhr.status >= 200 && xhr.status < 300 && data?.storage_key) {
				resolve(data);
				return;
			}
			reject(
				stageError(
					'upload',
					data?.error_description || `proxy upload failed: ${xhr.status}`,
					{ code: data?.error || 'proxy_upload_failed', status: xhr.status },
				),
			);
		};
		xhr.onerror = () => {
			cleanup();
			reject(stageError('upload', 'proxy upload network error', { code: 'proxy_upload_failed' }));
		};
		xhr.onabort = () => {
			cleanup();
			reject(stageError('upload', 'proxy upload aborted', { code: 'upload_aborted' }));
		};
		xhr.send(blob);
	});
}

// Server-side fetch for URL imports: the API pulls the GLB from `sourceUrl`
// itself (where same-origin/CORS doesn't apply) and stores it in R2, returning
// the storage_key + verified size/checksum to commit with. Used when the
// browser can't fetch the source directly — the common case for avatar CDNs
// that send no CORS headers. The request body is empty; the URL is passed as a
// query param and validated server-side against SSRF.
async function fetchRemoteViaProxy(sourceUrl, { onProgress, signal } = {}) {
	if (signal?.aborted) {
		throw stageError('fetch', 'Import aborted', { code: 'upload_aborted' });
	}
	const qs = new URLSearchParams({ content_type: 'model/gltf-binary', source_url: sourceUrl });
	// The browser shows indeterminate progress while the server fetches+stores.
	// apiFetch attaches the CSRF token for us on POST.
	onProgress?.(50);
	const res = await apiFetch(`${API}/api/avatars/upload?${qs.toString()}`, {
		method: 'POST',
		headers: { 'content-type': 'model/gltf-binary' },
		signal,
	});
	const data = res.headers.get('content-type')?.includes('application/json')
		? await res.json()
		: null;
	if (res.status === 401) {
		throw stageError('fetch', 'session expired', { status: 401, code: 'not_signed_in' });
	}
	if (!res.ok || !data?.storage_key) {
		throw stageError(
			'fetch',
			data?.error_description || `server fetch failed: ${res.status}`,
			{ code: data?.error || 'fetch_failed', status: res.status },
		);
	}
	onProgress?.(100);
	return data;
}

function stageError(stage, message, extras = {}) {
	const err = new Error(message);
	err.stage = stage;
	Object.assign(err, extras);
	return err;
}

async function postJson(path, body) {
	const res = await apiFetch(`${API}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = res.headers.get('content-type')?.includes('application/json')
		? await res.json()
		: null;
	if (!res.ok)
		throw Object.assign(new Error(data?.error_description || res.statusText), {
			status: res.status,
			data,
		});
	return data;
}

async function sha256Hex(blob) {
	const buf = await blob.arrayBuffer();
	const hash = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function deriveAvatarName(source, checksum) {
	if (source && typeof source === 'object' && typeof source.name === 'string') {
		const base = source.name.replace(/\.(glb|gltf)$/i, '').trim();
		if (base) return base.slice(0, 80);
	}
	if (typeof source === 'string') {
		try {
			const file = new URL(source).pathname.split('/').pop() || '';
			const base = file.replace(/\.(glb|gltf)$/i, '').trim();
			if (base) return base.slice(0, 80);
		} catch {
			/* ignore non-URL strings */
		}
	}
	return `Avatar #${checksum.slice(0, 6)}`;
}
