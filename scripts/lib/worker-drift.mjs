// Pure logic behind scripts/check-worker-drift.mjs: which Cloud Run service a
// worker's cloudbuild config deploys, where the serving image came from, and
// whether the worker's source has moved past it.
//
// Why this exists: the routine deploy only covers `three-ws-api`. Every GPU and
// CPU worker under workers/ is built by hand from its own cloudbuild.yaml, so a
// fix merged into workers/<name> sits unbuilt until somebody remembers. On
// 2026-11-03 remesh-service was still serving an image built 2026-06-13 while
// its Blender-teardown crash fix had been merged for weeks. Nothing compared a
// running image to its source; this module is that comparison.
//
// Every function here is free of I/O so the parser and the classifier are unit
// tested against fixtures captured from real `gcloud`/REST responses
// (tests/check-worker-drift.test.js). The script supplies the network and git.

import { parse as parseYaml } from 'yaml';

export const DEFAULT_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Expand Cloud Build substitutions (`${_NAME}`, `$_NAME`, `$PROJECT_ID`) in a
 * string. Unknown variables are left as written so a caller can tell an
 * unresolved value from a resolved one.
 */
export function expandSubstitutions(value, subs) {
	if (typeof value !== 'string') return value;
	return value
		.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (m, k) => (k in subs ? String(subs[k]) : m))
		.replace(/\$([A-Z_][A-Z0-9_]*)/g, (m, k) => (k in subs ? String(subs[k]) : m));
}

/** Read a `--flag=value` or `--flag value` out of an argv array. */
function flagFromArgs(args, flag) {
	for (let i = 0; i < args.length; i++) {
		const a = String(args[i]);
		if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
		if (a === flag && i + 1 < args.length) return String(args[i + 1]);
	}
	return null;
}

/** Read a `--flag=value` or `--flag value` out of a shell script fragment. */
function flagFromScript(script, flag) {
	const m = script.match(new RegExp(`${flag.replace(/-/g, '\\-')}[= ]"?([^\\s"\\\\]+)`));
	return m ? m[1] : null;
}

/**
 * Every Cloud Run service a cloudbuild config deploys, with the region each
 * deploy step targets. Recognises the two shapes used in workers/:
 *
 *   args form   entrypoint gcloud, args [run, deploy, <svc>, --region=<r>, ...]
 *   shell form  entrypoint bash/sh, args [-c, "gcloud run deploy <svc> --region=<r> ..."]
 *
 * Configs that only build and push (agent-sniper, robinhood-feed) roll the
 * service by hand; their header comment carries the exact
 * `gcloud run services update <svc>` (or `deploy`) line, which is read as a
 * declared target with `via: 'comment'` so the service is still tracked.
 *
 * @param {string} text  the YAML source
 * @param {object} [opts]
 * @param {string} [opts.projectId]  value for $PROJECT_ID
 * @returns {{ substitutions: object, targets: Array<{ service: string, region: string, via: 'step'|'comment', stepId: string|null }> }}
 */
export function parseCloudbuildTargets(text, { projectId = 'aerial-vehicle-466722-p5' } = {}) {
	const doc = parseYaml(text) || {};
	const subs = { PROJECT_ID: projectId, ...(doc.substitutions || {}) };
	const defaultRegion = subs._REGION ? String(subs._REGION) : 'us-central1';
	const targets = [];
	const seen = new Set();
	const add = (service, region, via, stepId) => {
		const svc = expandSubstitutions(service, subs);
		const reg = expandSubstitutions(region || defaultRegion, subs);
		if (!svc || /\$/.test(svc) || !/^[a-z][a-z0-9-]*$/.test(svc)) return;
		const key = `${svc}@${reg}`;
		if (seen.has(key)) return;
		seen.add(key);
		targets.push({ service: svc, region: reg, via, stepId });
	};

	for (const step of Array.isArray(doc.steps) ? doc.steps : []) {
		const args = Array.isArray(step?.args) ? step.args.map(String) : [];
		const stepId = step?.id ? String(step.id) : null;
		if (step?.entrypoint === 'gcloud' || /cloud-sdk|gcloud/.test(String(step?.name || ''))) {
			const runAt = args.indexOf('run');
			if (runAt !== -1 && args[runAt + 1] === 'deploy' && args[runAt + 2]) {
				add(args[runAt + 2], flagFromArgs(args, '--region'), 'step', stepId);
				continue;
			}
		}
		const script = args.filter((a) => a !== '-c').join('\n');
		for (const m of script.matchAll(/gcloud\s+run\s+deploy\s+(\S+)([\s\S]*?)(?:&&|\n\s*\n|$)/g)) {
			add(m[1], flagFromScript(m[2], '--region'), 'step', stepId);
		}
	}

	if (targets.length === 0) {
		const commentLines = text
			.split('\n')
			.filter((l) => /^\s*#/.test(l))
			.map((l) => l.replace(/^\s*#\s?/, ''))
			.join('\n')
			.replace(/\\\n/g, ' ');
		for (const m of commentLines.matchAll(
			/gcloud\s+run\s+(?:deploy|services\s+update)\s+([a-z][a-z0-9-]*)([^\n]*)/g,
		)) {
			add(m[1], flagFromScript(m[2], '--region'), 'comment', null);
		}
	}

	return { substitutions: subs, targets };
}

/**
 * The commit an image was built from, when its tags say so. Worker builds tag
 * with `$SHORT_SHA`, which is a real commit for trigger-style submits
 * (`1756bc51`), a decorated one for lane builds (`stage-a1d1ec3`, `rtx-<sha>`,
 * `21-959635b78-b3`), or `manual<epoch>` for hand submits, which names a build
 * time, not a commit. A Cloud Build id (a UUID) is never a commit.
 *
 * @param {string[]} tags
 * @param {(candidate: string) => string|null} resolveCommit  full sha or null
 * @returns {{ commit: string, tag: string }|null}
 */
export function sourceCommitFromTags(tags, resolveCommit) {
	for (const tag of tags || []) {
		if (!tag || tag === 'latest' || /^manual\d+$/.test(tag) || UUID.test(tag)) continue;
		for (const hex of hexTokens(tag)) {
			const full = resolveCommit(hex);
			if (full) return { commit: full, tag };
		}
	}
	return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Hex runs in a tag that could be a commit: `21-959635b78-b3` yields `959635b78`. */
export function hexTokens(tag) {
	return String(tag)
		.split(/[-_.]/)
		.filter((t) => /^[0-9a-f]{7,40}$/.test(t) && /[a-f]/.test(t) && /\d/.test(t));
}

/** Build time encoded in a `manual<epoch-seconds>` tag, as an ISO string. */
export function buildTimeFromManualTag(tags) {
	for (const tag of tags || []) {
		const m = String(tag).match(/^manual(\d{9,11})$/);
		if (m) return new Date(Number(m[1]) * 1000).toISOString();
	}
	return null;
}

/**
 * Pick the most trustworthy build time for a serving image. Artifact Registry's
 * `buildTime` is the docker build itself; `uploadTime` is the push. A revision's
 * createTime is the last resort and the least honest: a config-only
 * `gcloud run services update` (an env tweak, a scaling change) mints a new
 * revision around an old image, which would make a stale image look fresh.
 */
export function pickBuiltAt({ image, tags, revisionCreateTime }) {
	if (image?.buildTime) return { at: image.buildTime, source: 'registry build' };
	if (image?.uploadTime) return { at: image.uploadTime, source: 'registry upload' };
	const manual = buildTimeFromManualTag(tags);
	if (manual) return { at: manual, source: 'manual tag' };
	if (revisionCreateTime) return { at: revisionCreateTime, source: 'revision' };
	return { at: null, source: 'unknown' };
}

/**
 * Commits that changed the worker's source after the image was built.
 *
 * @param {Array<{ sha: string, committedAt: string }>} history  newest first, for the worker's paths
 * @param {object} p
 * @param {string|null} p.builtAt       ISO build time
 * @param {Set<string>|null} p.unbuiltShas  exact set from `git rev-list <commit>..HEAD -- paths`, when the image names its commit
 */
export function unbuiltCommits(history, { builtAt, unbuiltShas }) {
	if (unbuiltShas) return history.filter((c) => unbuiltShas.has(c.sha));
	if (!builtAt) return [];
	const t = Date.parse(builtAt);
	return history.filter((c) => Date.parse(c.committedAt) > t);
}

/**
 * Status for one (service, region). A worker whose unbuilt source has waited
 * longer than the grace window is DRIFTED and fails the check; younger unbuilt
 * work is `drifting`, reported but not failing, because a fix merged this
 * morning is not yet a missed deploy. Waiting is measured from the oldest
 * unbuilt commit, but never from before the image's own build.
 */
export function classify({ deployed, unbuilt, builtAt = null, declared = true, now = Date.now(), graceDays = DEFAULT_GRACE_DAYS }) {
	if (!deployed) return { status: 'NOT-DEPLOYED', behind: 0, waitingDays: null, failing: false };
	if (!unbuilt.length) return { status: 'current', behind: 0, waitingDays: 0, failing: false };
	const oldest = Math.min(...unbuilt.map((c) => Date.parse(c.committedAt)));
	// A commit dated before the build that the image still lacks came in on a
	// side branch merged later; it has been waiting since the build at most.
	const since = builtAt ? Math.max(oldest, Date.parse(builtAt)) : oldest;
	const waitingDays = Math.floor((now - since) / DAY_MS);
	const over = waitingDays > graceDays;
	// A copy in a region the config does not deploy to (a hand-made standby) is
	// reported but never fails the check: no rebuild can refresh it, so failing
	// on it would make the check impossible to clear by shipping.
	return { status: over ? 'DRIFTED' : 'drifting', behind: unbuilt.length, waitingDays, failing: over && declared };
}

/** The revisions actually taking traffic, from a Run Admin API v2 Service. */
export function servingRevisions(service) {
	const out = [];
	for (const t of service?.trafficStatuses || []) {
		if (!t.percent) continue;
		const name = t.revision || (t.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' ? service.latestReadyRevision : null);
		if (!name) continue;
		out.push({ revision: name.split('/').pop(), percent: t.percent });
	}
	if (!out.length && service?.latestReadyRevision) {
		out.push({ revision: service.latestReadyRevision.split('/').pop(), percent: 100 });
	}
	return out;
}

/**
 * Split an image reference into the Artifact Registry coordinates needed to
 * look it up: `us-central1-docker.pkg.dev/<project>/<repo>/<image>@sha256:...`
 * or `...:<tag>`.
 */
export function parseImageRef(ref) {
	const m = String(ref || '').match(/^([a-z0-9-]+)-docker\.pkg\.dev\/([^/]+)\/([^/]+)\/([^@:]+)(?:@(sha256:[0-9a-f]+)|:([^@]+))?$/);
	if (!m) return null;
	return { location: m[1], project: m[2], repository: m[3], image: m[4], digest: m[5] || null, tag: m[6] || null };
}

const pad = (s, n) => String(s ?? '').padEnd(n);
const day = (iso) => (iso ? iso.slice(0, 10) : '-');

/** Plain-text table for the terminal. */
export function formatTable(rows) {
	const head = ['worker', 'service@region', 'serving revision', 'built at', 'built from', 'last source change', 'behind', 'waiting', 'status'];
	const body = rows.map((r) => [
		r.worker,
		`${r.service}@${r.region}${r.declared === false ? ' (extra)' : ''}`,
		r.revision || '-',
		r.builtAt ? `${day(r.builtAt)} (${r.builtAtSource})` : '-',
		r.sourceCommit ? r.sourceCommit.slice(0, 9) : r.imageTag || '-',
		day(r.lastSourceChange),
		r.status === 'NOT-DEPLOYED' ? '-' : String(r.behind),
		r.waitingDays == null ? '-' : `${r.waitingDays}d`,
		r.status,
	]);
	const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
	const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join('  ').trimEnd();
	return [line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}
