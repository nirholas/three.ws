// External skill import: registries, scans awaiting the owner, installs,
// update diffs, forks and publishing (tables in
// migrations/20261011013000_skill_imports.sql).
//
// The flow every surface (REST, MCP, the /skills/import page) goes through:
//   1. browse     pinned indexes of the built-in and owner-added registries,
//                 licence-filtered, with install counts
//   2. scan       fetch one skill at its pin, scan it, store the exact bytes as
//                 a pending request (a refused scan is closed on the spot)
//   3. approve    the owner's decision installs exactly the scanned bytes as a
//                 prompt-only skill; a gated skill needs acknowledge_gated
//   4. updates    re-resolve the registry, diff the new revision against what
//                 is installed, and open a new scanned request to apply it
// Nothing here executes upstream code, and nothing re-fetches between scan and
// install, so an upstream change can never silently alter an installed skill.

import { z } from 'zod';
import { createTwoFilesPatch, diffLines } from 'diff';
import { stringify as yamlStringify } from 'yaml';
import { sql } from './db.js';
import { isUuid } from './validate.js';
import {
	CustomSkillError,
	requireOwnedAgent,
	assertRoom,
	freeSlug,
	slugify,
	listSkills,
	presentSkill,
} from './agent-custom-skills.js';
import {
	BUILTIN_REGISTRY_INPUTS,
	CATEGORIES,
	parseRegistryInput,
	registryIndex,
	fetchSkillBody,
	licensePolicy,
	classifyLicense,
	parseSkillFile,
	forgetIndex,
	sha256Hex,
} from './skill-import-sources.js';
import { scanSkill } from './skill-import-scan.js';

export const MAX_REGISTRIES_PER_USER = 20;
export const PUBLIC_ORIGIN = 'https://three.ws';
const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const OPEN_LICENSES = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'CC-BY-4.0', 'MPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'LGPL-3.0', 'CC-BY-SA-4.0'];

// ── Schemas ─────────────────────────────────────────────────────────────────

export const registryAddSchema = z.object({
	registry: z.string().trim().min(3).max(500),
	label: z.string().trim().min(2).max(80).optional(),
});

export const scanSchema = z.object({
	agent_id: z.string().uuid(),
	registry: z.string().trim().min(3).max(500),
	skill: z.string().trim().min(1).max(300),
});

export const decideSchema = z.object({
	decision: z.enum(['approve', 'refuse']),
	acknowledge_gated: z.boolean().optional().default(false),
	enabled: z.boolean().optional().default(true),
});

export const forkSchema = z
	.object({
		agent_id: z.string().uuid(),
		skill_id: z.string().uuid().optional(),
		published_slug: z.string().trim().min(3).max(80).regex(TAG_RE).optional(),
		name: z.string().trim().min(2).max(80).optional(),
	})
	.refine((v) => !!v.skill_id !== !!v.published_slug, { message: 'give exactly one of skill_id or published_slug' });

export const publishSchema = z.object({
	agent_id: z.string().uuid(),
	skill_id: z.string().uuid(),
	license: z.enum(OPEN_LICENSES),
	category: z.enum(CATEGORIES),
	confirm_publish: z.literal(true, { errorMap: () => ({ message: 'publishing makes this skill public; pass confirm_publish: true' }) }),
});

// ── Registries ──────────────────────────────────────────────────────────────

const builtins = BUILTIN_REGISTRY_INPUTS.map(({ input, label }) => ({ ...parseRegistryInput(input), label, builtin: true }));

/** The serialisable part of a descriptor, enough to rebuild it later. */
function registrySpec(reg) {
	if (reg.kind === 'github') return { kind: 'github', owner: reg.owner, repo: reg.repo, ref: reg.ref, subpath: reg.subpath };
	if (reg.kind === 'manifest') return { kind: 'manifest', url: reg.url };
	return { kind: 'published' };
}

/** Rebuild a descriptor from a stored spec (provenance or a registry row). */
export function registryFromSpec(spec, label) {
	if (!spec || typeof spec !== 'object') throw new CustomSkillError(400, 'invalid_registry', 'registry spec missing');
	if (spec.kind === 'published') return { ...builtins.find((b) => b.kind === 'published') };
	if (spec.kind === 'manifest') return { ...parseRegistryInput(spec.url), ...(label ? { label } : {}) };
	const reg = parseRegistryInput(`${spec.owner}/${spec.repo}${spec.subpath ? `/${spec.subpath}` : ''}`);
	return { ...reg, ref: spec.ref || null, ...(label ? { label } : {}) };
}

function presentRegistry(reg, extra = {}) {
	return { key: reg.key, kind: reg.kind, label: reg.label, url: reg.url, builtin: !!reg.builtin, ...extra };
}

/** Built-in registries plus the ones this owner added. */
export async function listRegistries(userId) {
	const rows = userId
		? await sql`SELECT id, key, label, spec, created_at FROM skill_import_registries WHERE user_id = ${userId} ORDER BY created_at ASC`
		: [];
	const own = rows.map((r) => ({ ...registryFromSpec(r.spec, r.label), key: r.key, id: r.id, added_at: r.created_at }));
	return [...builtins, ...own.filter((r) => !builtins.some((b) => b.key === r.key))];
}

async function resolveRegistry(userId, keyOrInput) {
	const all = await listRegistries(userId);
	const byKey = all.find((r) => r.key === keyOrInput);
	if (byKey) return byKey;
	const parsed = parseRegistryInput(keyOrInput);
	const known = all.find((r) => r.key === parsed.key);
	if (known) return known;
	throw new CustomSkillError(404, 'registry_not_added', `add ${parsed.label} as a registry first (POST /api/skill-imports/registries)`);
}

/** Add a registry after proving it resolves to at least one skill. */
export async function addRegistry(userId, { registry, label }) {
	const reg = parseRegistryInput(registry);
	if (reg.kind === 'published' || builtins.some((b) => b.key === reg.key)) {
		throw new CustomSkillError(409, 'already_added', `${reg.label} is a built-in registry`);
	}
	const [{ n }] = await sql`SELECT count(*)::int AS n FROM skill_import_registries WHERE user_id = ${userId}`;
	if (n >= MAX_REGISTRIES_PER_USER) throw new CustomSkillError(409, 'limit_reached', `you can add at most ${MAX_REGISTRIES_PER_USER} registries`);
	const index = await registryIndex(reg, { fresh: true, loadPublished });
	if (!index.skills.length) {
		throw new CustomSkillError(422, 'no_skills_found', `${reg.label} has no SKILL.md files${reg.kind === 'github' ? ' under that path' : ''}`, { errors: index.errors.slice(0, 5) });
	}
	const finalLabel = label || index.registry.name || reg.label;
	const [row] = await sql`
		INSERT INTO skill_import_registries (user_id, kind, key, label, spec)
		VALUES (${userId}, ${reg.kind}, ${reg.key}, ${finalLabel}, ${JSON.stringify(registrySpec(reg))}::jsonb)
		ON CONFLICT (user_id, key) DO UPDATE SET label = EXCLUDED.label
		RETURNING id, key, label, created_at
	`;
	return presentRegistry({ ...reg, label: row.label }, { id: row.id, added_at: row.created_at, skills: index.skills.length, commit: index.commit });
}

export async function removeRegistry(userId, key) {
	const rows = await sql`DELETE FROM skill_import_registries WHERE user_id = ${userId} AND key = ${key} RETURNING key`;
	if (!rows.length) throw new CustomSkillError(404, 'not_found', 'registry not found among the ones you added');
	forgetIndex(key);
	return { removed: true, key };
}

// ── Published registry (served from skill_publications) ─────────────────────

/** The SKILL.md a publication serves. Deterministic: its sha256 is the pin. */
export function renderPublishedSkill(pub) {
	const front = yamlStringify({
		name: pub.slug,
		description: pub.description || pub.name,
		license: pub.license,
		metadata: { title: pub.name, author: pub.author || 'three.ws user', version: pub.version, category: pub.category, tags: pub.tags || [] },
	}).trim();
	return `---\n${front}\n---\n\n${String(pub.content).trim()}\n`;
}

/** The published-skills registry as a three.ws/skill-registry@1 manifest. */
export async function publishedManifest(origin = PUBLIC_ORIGIN) {
	const rows = await sql`
		SELECT slug, name, description, author, tags, category, license, version, content, content_sha256, attribution, updated_at
		FROM skill_publications WHERE unpublished_at IS NULL
		ORDER BY updated_at DESC LIMIT 500
	`;
	return {
		schema: 'three.ws/skill-registry@1',
		name: 'Published on three.ws',
		homepage: `${origin}/skills/import`,
		skills: rows.map((r) => ({
			slug: r.slug,
			name: r.name,
			description: r.description,
			author: r.author,
			version: r.version,
			license: r.license,
			category: r.category,
			tags: r.tags,
			url: `${origin}/api/skill-imports/published/${r.slug}/SKILL.md`,
			sha256: r.content_sha256,
			revision: new Date(r.updated_at).toISOString(),
			bytes: Buffer.byteLength(renderPublishedSkill(r)),
			...(r.attribution?.repo_url ? { source_repo: r.attribution.repo_url } : {}),
		})),
	};
}

const loadPublished = () => publishedManifest(PUBLIC_ORIGIN);

/** One published SKILL.md, or null. */
export async function publishedSkillFile(slug) {
	const [row] = await sql`
		SELECT slug, name, description, author, tags, category, license, version, content
		FROM skill_publications WHERE slug = ${slug} AND unpublished_at IS NULL
	`;
	return row ? renderPublishedSkill(row) : null;
}

async function loadPublishedBody(slug) {
	const text = await publishedSkillFile(slug);
	if (text == null) throw new CustomSkillError(404, 'not_found', `no published skill "${slug}"`);
	return text;
}

// ── Browse ──────────────────────────────────────────────────────────────────

async function installCounts(keys) {
	if (!keys.length) return new Map();
	const rows = await sql`
		SELECT provenance ->> 'key' AS key, count(*)::int AS n
		FROM agent_custom_skills
		WHERE source = 'external' AND provenance ->> 'key' = ANY(${keys})
		GROUP BY 1
	`;
	return new Map(rows.map((r) => [r.key, r.n]));
}

function presentEntry(entry, installs) {
	const policy = licensePolicy(entry.license);
	return {
		key: entry.key,
		registry: entry.registry,
		slug: entry.slug,
		name: entry.name,
		description: entry.description,
		category: entry.category,
		tags: entry.tags,
		author: entry.author,
		version: entry.version,
		license: { ...entry.license, notice: policy.notice || null },
		requested_tools: entry.requested_tools,
		requested_permissions: entry.requested_permissions,
		files: entry.files.map((f) => f.path),
		pin: entry.pin,
		source_url: entry.source_url,
		repo_url: entry.repo_url,
		path: entry.path,
		installs: installs.get(entry.key) || 0,
	};
}

/**
 * Browse every registry (or one), listed skills first. Skills whose licence
 * does not permit reuse are returned separately under `excluded` with the
 * reason, never in `skills`.
 */
export async function browse(userId, { registry = null, category = null, q = null } = {}) {
	const regs = registry ? [await resolveRegistry(userId, registry)] : await listRegistries(userId);
	const results = await Promise.all(
		regs.map(async (reg) => {
			try {
				return { reg, index: await registryIndex(reg, { loadPublished }) };
			} catch (err) {
				return { reg, error: err.message, code: err.code || 'upstream_error' };
			}
		}),
	);
	const entries = results.flatMap((r) => r.index?.skills || []);
	const counts = await installCounts(entries.map((e) => e.key));
	const needle = q ? String(q).toLowerCase() : null;
	const matches = (e) => !needle || `${e.name} ${e.description} ${e.tags.join(' ')} ${e.slug}`.toLowerCase().includes(needle);
	const listed = [];
	const excluded = [];
	for (const e of entries) {
		if (!matches(e)) continue;
		const policy = licensePolicy(e.license);
		if (!policy.listed) {
			excluded.push({ key: e.key, name: e.name, registry: e.registry.label, reason: policy.reason, source_url: e.source_url });
			continue;
		}
		if (category && e.category !== category) continue;
		listed.push(presentEntry(e, counts));
	}
	for (const r of results) {
		for (const err of r.index?.errors || []) excluded.push({ key: `${r.reg.key}#${err.path}`, name: err.path, registry: r.reg.label, reason: err.error });
	}
	listed.sort((a, b) => b.installs - a.installs || a.name.localeCompare(b.name));
	const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
	for (const e of entries) if (licensePolicy(e.license).listed && matches(e)) byCategory[e.category] += 1;
	return {
		registries: results.map((r) =>
			presentRegistry(r.reg, r.index
				? { commit: r.index.commit, fetched_at: r.index.fetched_at, cached: r.index.cached, skills: r.index.skills.length, truncated: r.index.truncated }
				: { error: r.error, code: r.code }),
		),
		categories: byCategory,
		skills: listed,
		excluded,
	};
}

async function findEntry(reg, skill, { fresh = false } = {}) {
	const index = await registryIndex(reg, { fresh, loadPublished });
	const want = String(skill).replace(/^.*#/, '');
	const entry = index.skills.find((s) => s.key === skill || s.path === want || s.dir === want || s.slug === want.toLowerCase());
	if (!entry) {
		const failed = index.errors.find((e) => e.path === want || e.path.startsWith(`${want}/`) || e.path.includes(`/${want}/`));
		if (failed) throw new CustomSkillError(422, 'skill_unreadable', failed.error);
		throw new CustomSkillError(404, 'skill_not_found', `no skill "${want}" in ${reg.label}`);
	}
	return { entry, index };
}

// ── Scan requests ───────────────────────────────────────────────────────────

function stripFrontmatter(text) {
	const parsed = parseSkillFile(text);
	return parsed ? parsed.body : String(text).trim();
}

function provenanceFor(reg, entry, content, body, scan) {
	return {
		key: entry.key,
		registry: { key: reg.key, label: reg.label, kind: reg.kind, spec: registrySpec(reg) },
		repo_url: entry.repo_url,
		source_url: entry.source_url,
		path: entry.path,
		commit: entry.pin.commit || null,
		blob_sha: entry.pin.blob_sha || null,
		revision: entry.pin.revision || null,
		upstream_commit: entry.upstream_commit || null,
		sha256: sha256Hex(content),
		body_sha256: sha256Hex(body),
		license: { spdx: entry.license.spdx, class: entry.license.class, source: entry.license.source, statement: entry.license.statement },
		author: entry.author,
		version: entry.version,
		category: entry.category,
		scan_verdict: scan.verdict,
		scanned_at: scan.scanned_at,
	};
}

/** Shape a request row for every surface. */
export function presentRequest(row) {
	return {
		id: row.id,
		status: row.status,
		verdict: row.verdict,
		gated: row.gated,
		agent_id: row.agent_id,
		replaces_skill_id: row.replaces_skill_id,
		installed_skill_id: row.installed_skill_id,
		skill: { key: row.skill_key, slug: row.slug, name: row.name, description: row.description, ...row.manifest },
		provenance: row.provenance,
		scan: row.scan,
		content: row.content,
		content_sha256: row.content_sha256,
		decided_by: row.decided_by,
		created_at: row.created_at,
		decided_at: row.decided_at,
		expires_at: row.expires_at,
		approve_requires: row.status === 'pending' ? { acknowledge_gated: row.gated } : null,
	};
}

async function openRequest({ userId, agentId, reg, entry, replacesSkillId = null }) {
	const content = await fetchSkillBody(reg, entry, { loadPublishedBody });
	const body = stripFrontmatter(content);
	const scan = await scanSkill(entry, content);
	const provenance = provenanceFor(reg, entry, content, body, scan);
	const manifest = {
		category: entry.category,
		tags: entry.tags,
		author: entry.author,
		version: entry.version,
		requested_tools: entry.requested_tools,
		requested_permissions: entry.requested_permissions,
		files: entry.files.map((f) => f.path),
	};
	const refused = scan.verdict === 'refused';
	const [row] = await sql`
		INSERT INTO skill_import_requests
			(user_id, agent_id, replaces_skill_id, skill_key, slug, name, description, content, content_sha256,
			 manifest, provenance, scan, verdict, gated, status, decided_by, decided_at)
		VALUES
			(${userId}, ${agentId}, ${replacesSkillId}, ${entry.key}, ${entry.slug}, ${entry.name.slice(0, 200)},
			 ${entry.description.slice(0, 2000)}, ${content}, ${provenance.sha256},
			 ${JSON.stringify(manifest)}::jsonb, ${JSON.stringify(provenance)}::jsonb, ${JSON.stringify(scan)}::jsonb,
			 ${scan.verdict}, ${scan.gated}, ${refused ? 'refused' : 'pending'},
			 ${refused ? 'scanner' : null}, ${refused ? new Date().toISOString() : null})
		RETURNING *
	`;
	return presentRequest(row);
}

/** Fetch one skill at its pin and scan it into a pending request. */
export async function scanForInstall(userId, { agent_id, registry, skill }) {
	await requireOwnedAgent(agent_id, userId);
	const reg = await resolveRegistry(userId, registry);
	const { entry } = await findEntry(reg, skill);
	return openRequest({ userId, agentId: agent_id, reg, entry });
}

async function ownedRequest(userId, id) {
	if (!isUuid(id)) throw new CustomSkillError(400, 'validation_error', 'request id must be a valid uuid');
	const [row] = await sql`SELECT * FROM skill_import_requests WHERE id = ${id} AND user_id = ${userId}`;
	if (!row) throw new CustomSkillError(404, 'not_found', 'import request not found');
	return row;
}

export async function getRequest(userId, id) {
	return presentRequest(await ownedRequest(userId, id));
}

export async function listRequests(userId, { status = null, limit = 30 } = {}) {
	const rows = status
		? await sql`SELECT * FROM skill_import_requests WHERE user_id = ${userId} AND status = ${status} ORDER BY created_at DESC LIMIT ${limit}`
		: await sql`SELECT * FROM skill_import_requests WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}`;
	return rows.map(presentRequest);
}

function installFields(row) {
	const tags = (row.manifest?.tags || []).filter((t) => TAG_RE.test(t) && t.length <= 32).slice(0, 8);
	const version = SEMVER_RE.test(row.manifest?.version || '') ? row.manifest.version : '1.0.0';
	const name = (row.name.length >= 2 ? row.name : row.slug).slice(0, 80);
	return { tags, version, name, description: row.description.slice(0, 400), body: stripFrontmatter(row.content) };
}

/**
 * The owner's decision. Approve installs (or updates) exactly the scanned
 * bytes; a refused scan can never be approved, and a gated skill needs
 * `acknowledge_gated`. Refuse closes the request.
 */
export async function decideRequest(userId, id, { decision, acknowledge_gated = false, enabled = true }) {
	const current = await ownedRequest(userId, id);
	if (current.status !== 'pending') throw new CustomSkillError(409, 'already_decided', `this request is already ${current.status}`);
	if (decision === 'refuse') {
		const [row] = await sql`
			UPDATE skill_import_requests SET status = 'refused', decided_by = 'owner', decided_at = now()
			WHERE id = ${id} AND user_id = ${userId} AND status = 'pending' RETURNING *`;
		if (!row) throw new CustomSkillError(409, 'already_decided', 'this request was decided elsewhere');
		return { request: presentRequest(row) };
	}
	if (current.verdict === 'refused') throw new CustomSkillError(422, 'scan_refused', 'the scan refused this skill; it cannot be installed');
	if (new Date(current.expires_at).getTime() < Date.now()) throw new CustomSkillError(410, 'expired', 'this scan expired; scan the skill again');
	if (current.gated && !acknowledge_gated) {
		throw new CustomSkillError(428, 'acknowledge_gated', 'this skill asks for spending, signing or outbound messaging; approve with acknowledge_gated: true to install it under the spend gate', {
			capabilities: current.scan?.capabilities,
		});
	}
	await requireOwnedAgent(current.agent_id, userId);

	const [claimed] = await sql`
		UPDATE skill_import_requests SET status = 'approved', decided_by = 'owner', decided_at = now()
		WHERE id = ${id} AND user_id = ${userId} AND status = 'pending' RETURNING *`;
	if (!claimed) throw new CustomSkillError(409, 'already_decided', 'this request was decided elsewhere');

	try {
		const f = installFields(claimed);
		const prov = JSON.stringify({ ...claimed.provenance, approved_at: new Date().toISOString(), request_id: claimed.id });
		let installed;
		if (claimed.replaces_skill_id) {
			[installed] = await sql`
				UPDATE agent_custom_skills SET
					name = ${f.name}, description = ${f.description}, tags = ${f.tags}, version = ${f.version},
					content = ${f.body}, provenance = ${prov}::jsonb, gated = ${claimed.gated},
					source_version = ${(claimed.provenance.commit || claimed.provenance.revision || '').slice(0, 40) || null},
					source_sha256 = ${claimed.content_sha256}, updated_at = now()
				WHERE id = ${claimed.replaces_skill_id} AND agent_id = ${claimed.agent_id} AND source = 'external'
				RETURNING id`;
			if (!installed) throw new CustomSkillError(404, 'not_found', 'the skill this update was for is gone');
		} else {
			const [dupe] = await sql`
				SELECT id FROM agent_custom_skills
				WHERE agent_id = ${claimed.agent_id} AND source = 'external' AND provenance ->> 'key' = ${claimed.skill_key}`;
			if (dupe) throw new CustomSkillError(409, 'already_installed', 'this skill is already installed on the agent; check for an update instead', { skill_id: dupe.id });
			await assertRoom(claimed.agent_id);
			const slug = await freeSlug(claimed.agent_id, slugify(claimed.slug));
			[installed] = await sql`
				INSERT INTO agent_custom_skills
					(agent_id, user_id, slug, name, description, author, tags, version, content, enabled,
					 source, source_slug, source_version, source_sha256, provenance, gated)
				VALUES
					(${claimed.agent_id}, ${userId}, ${slug}, ${f.name}, ${f.description}, ${claimed.manifest?.author || null},
					 ${f.tags}, ${f.version}, ${f.body}, ${enabled},
					 'external', ${claimed.slug}, ${(claimed.provenance.commit || claimed.provenance.revision || '').slice(0, 40) || null},
					 ${claimed.content_sha256}, ${prov}::jsonb, ${claimed.gated})
				RETURNING id`;
		}
		const [done] = await sql`UPDATE skill_import_requests SET installed_skill_id = ${installed.id} WHERE id = ${id} RETURNING *`;
		const { skills, budget } = await listSkills(claimed.agent_id);
		return { request: presentRequest(done), skill: skills.find((s) => s.id === installed.id), budget };
	} catch (err) {
		await sql`UPDATE skill_import_requests SET status = 'pending', decided_by = null, decided_at = null WHERE id = ${id}`;
		throw err;
	}
}

// ── Updates ─────────────────────────────────────────────────────────────────

async function ownedSkillRow(userId, agentId, skillId) {
	await requireOwnedAgent(agentId, userId);
	if (!isUuid(skillId)) throw new CustomSkillError(400, 'validation_error', 'skill_id must be a valid uuid');
	const [row] = await sql`SELECT * FROM agent_custom_skills WHERE id = ${skillId} AND agent_id = ${agentId}`;
	if (!row) throw new CustomSkillError(404, 'not_found', 'skill not found on this agent');
	return row;
}

/**
 * Compare an installed external skill with its registry's current revision.
 * Unchanged: { changed: false }. Changed: the unified diff from what is
 * installed to the new revision, and a scanned request that applies it once
 * the owner approves (`open_request: false` to only preview).
 */
export async function updateDiff(userId, { agent_id, skill_id, open_request = true }) {
	const row = await ownedSkillRow(userId, agent_id, skill_id);
	if (row.source !== 'external' || !row.provenance?.registry?.spec) {
		throw new CustomSkillError(400, 'not_external', 'only a skill imported from an external registry has upstream updates');
	}
	const reg = registryFromSpec(row.provenance.registry.spec, row.provenance.registry.label);
	const want = row.provenance.key.replace(/^.*#/, '');
	let found;
	try {
		found = await findEntry(reg, want, { fresh: true });
	} catch (err) {
		if (err.code === 'skill_not_found') return { changed: false, removed: true, installed: pinOf(row.provenance) };
		throw err;
	}
	const { entry } = found;
	const samePin = reg.kind === 'github' ? entry.pin.blob_sha === row.provenance.blob_sha : entry.pin.sha256 === row.provenance.sha256;
	if (samePin) return { changed: false, installed: pinOf(row.provenance), latest: pinOf({ ...entry.pin, sha256: row.provenance.sha256 }) };

	const content = await fetchSkillBody(reg, entry, { loadPublishedBody });
	const nextBody = stripFrontmatter(content);
	const patch = createTwoFilesPatch(`installed/${row.slug}/SKILL.md`, `upstream/${row.slug}/SKILL.md`, `${row.content.trim()}\n`, `${nextBody.trim()}\n`, pinLabel(row.provenance), pinLabel(entry.pin));
	const parts = diffLines(`${row.content.trim()}\n`, `${nextBody.trim()}\n`);
	const stats = {
		added: parts.filter((p) => p.added).reduce((n, p) => n + p.count, 0),
		removed: parts.filter((p) => p.removed).reduce((n, p) => n + p.count, 0),
	};
	const locallyModified = !!row.provenance.body_sha256 && sha256Hex(row.content) !== row.provenance.body_sha256;
	const request = open_request ? await openRequest({ userId, agentId: agent_id, reg, entry, replacesSkillId: row.id }) : null;
	return { changed: true, installed: pinOf(row.provenance), latest: pinOf(entry.pin), locally_modified: locallyModified, stats, diff: patch, request };
}

function pinOf(p) {
	return { commit: p.commit || null, blob_sha: p.blob_sha || null, sha256: p.sha256 || null, revision: p.revision || null };
}

function pinLabel(p) {
	return p.commit ? `commit ${p.commit.slice(0, 12)}` : p.sha256 ? `sha256 ${p.sha256.slice(0, 12)}` : '';
}

// ── Fork ────────────────────────────────────────────────────────────────────

/**
 * Copy a skill onto one of the owner's agents as their own editable skill:
 * from any skill they own (any agent, any source) or from a published one. A
 * fork keeps its upstream provenance and licence, and a fork of a gated skill
 * stays gated. A published skill is re-scanned before it is copied.
 */
export async function forkSkill(userId, input) {
	const { agent_id, skill_id, published_slug, name } = input;
	await requireOwnedAgent(agent_id, userId);
	let source;
	let gated;
	let forkedFrom = null;
	let origin;
	if (skill_id) {
		const [row] = await sql`
			SELECT s.* FROM agent_custom_skills s JOIN agent_identities a ON a.id = s.agent_id
			WHERE s.id = ${skill_id} AND a.user_id = ${userId} AND a.deleted_at IS NULL`;
		if (!row) throw new CustomSkillError(404, 'not_found', 'skill not found among your agents');
		source = { name: row.name, slug: row.slug, description: row.description, tags: row.tags, version: row.version, content: row.content, author: row.author };
		gated = row.gated;
		forkedFrom = row.id;
		const parent = row.provenance?.forked_from || null;
		origin = {
			kind: 'skill',
			id: row.id,
			agent_id: row.agent_id,
			slug: row.slug,
			source: row.source,
			repo_url: row.provenance?.repo_url || parent?.repo_url || null,
			license: row.provenance?.license || parent?.license || null,
			// The bytes someone else wrote: an import's upstream body, or whatever
			// the parent fork inherited. Null for a skill the owner wrote.
			original_body_sha256:
				row.source === 'custom' ? parent?.original_body_sha256 || null : sha256Hex(row.content),
			author: row.author || null,
		};
	} else {
		const [pub] = await sql`SELECT * FROM skill_publications WHERE slug = ${published_slug} AND unpublished_at IS NULL`;
		if (!pub) throw new CustomSkillError(404, 'not_found', `no published skill "${published_slug}"`);
		const text = renderPublishedSkill(pub);
		const entry = {
			name: pub.name,
			description: pub.description,
			parse_ok: true,
			license: { ...classifyLicense(pub.license), source: 'publication', statement: pub.license },
			files: [],
			requested_tools: [],
			requested_permissions: [],
		};
		const scan = await scanSkill(entry, text);
		if (scan.verdict === 'refused') throw new CustomSkillError(422, 'scan_refused', 'this published skill no longer passes the scan', { findings: scan.findings });
		source = { name: pub.name, slug: pub.slug, description: pub.description, tags: pub.tags, version: pub.version, content: pub.content, author: pub.author };
		gated = scan.gated;
		origin = {
			kind: 'published',
			slug: pub.slug,
			publication_id: pub.id,
			sha256: pub.content_sha256,
			repo_url: pub.attribution?.repo_url || null,
			license: { spdx: pub.license, class: classifyLicense(pub.license).class },
			original_body_sha256: sha256Hex(pub.content),
			author: pub.author,
		};
	}
	await assertRoom(agent_id);
	const slug = await freeSlug(agent_id, slugify(name || source.slug));
	const provenance = { forked_from: origin, forked_at: new Date().toISOString(), body_sha256: sha256Hex(source.content) };
	const [row] = await sql`
		INSERT INTO agent_custom_skills
			(agent_id, user_id, slug, name, description, author, tags, version, content, enabled, source, provenance, gated, forked_from)
		VALUES
			(${agent_id}, ${userId}, ${slug}, ${name || source.name}, ${source.description}, ${source.author || null},
			 ${source.tags || []}, ${source.version}, ${source.content}, true, 'custom',
			 ${JSON.stringify(provenance)}::jsonb, ${!!gated}, ${forkedFrom})
		RETURNING id`;
	const { skills, budget } = await listSkills(agent_id);
	return { skill: skills.find((s) => s.id === row.id) || presentSkill(row), budget };
}

// ── Publish ─────────────────────────────────────────────────────────────────

async function publicSlug(userId, base, skillId) {
	const [mine] = await sql`SELECT slug FROM skill_publications WHERE user_id = ${userId} AND skill_id = ${skillId}`;
	if (mine) return mine.slug;
	const taken = new Set((await sql`SELECT slug FROM skill_publications WHERE slug LIKE ${`${base}%`}`).map((r) => r.slug));
	if (!taken.has(base)) return base;
	for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
	throw new CustomSkillError(409, 'slug_taken', 'pick a different skill slug before publishing');
}

/**
 * Publish an owned skill to the three.ws registry manifest. Your own skills
 * and forks you changed are publishable; an unchanged import is not (it is
 * someone else's work), and a fork of a copyleft skill keeps that licence.
 */
export async function publishSkill(userId, { agent_id, skill_id, license, category }) {
	const row = await ownedSkillRow(userId, agent_id, skill_id);
	if (row.source === 'external' || row.source === 'community') {
		throw new CustomSkillError(409, 'not_yours', `"${row.name}" was imported from ${row.source === 'community' ? 'the community registry' : row.provenance?.registry?.label || 'another registry'}. Fork it, make it yours, then publish the fork.`);
	}
	const upstream = row.provenance?.forked_from || null;
	if (upstream) {
		if (upstream.original_body_sha256 && sha256Hex(row.content) === upstream.original_body_sha256) {
			throw new CustomSkillError(409, 'unchanged_copy', 'this fork is still identical to the skill it came from; change it before publishing');
		}
		const upLicense = upstream.license;
		if (upLicense?.class === 'copyleft' && upLicense.spdx && upLicense.spdx !== license) {
			throw new CustomSkillError(422, 'license_conflict', `this skill derives from ${upLicense.spdx} work, so it must be published under ${upLicense.spdx}`);
		}
		if (upLicense && !licensePolicy(upLicense).listed) {
			throw new CustomSkillError(422, 'license_conflict', 'the skill this was forked from does not permit redistribution');
		}
	}
	const entry = {
		name: row.name,
		description: row.description || row.name,
		parse_ok: true,
		license: { ...classifyLicense(license), source: 'publisher', statement: license },
		files: [],
		requested_tools: [],
		requested_permissions: [],
	};
	const scan = await scanSkill(entry, row.content);
	if (scan.verdict === 'refused') {
		throw new CustomSkillError(422, 'scan_refused', 'the scan refused this skill, so it cannot be published', { findings: scan.findings.filter((f) => f.severity === 'block') });
	}
	const [user] = await sql`SELECT display_name, username FROM users WHERE id = ${userId}`;
	const author = user?.display_name || user?.username || 'three.ws user';
	const slug = await publicSlug(userId, slugify(row.slug), row.id);
	const pub = { slug, name: row.name, description: row.description || row.name, author, tags: row.tags || [], category, license, version: row.version, content: row.content };
	const contentSha = sha256Hex(renderPublishedSkill(pub));
	const attribution = upstream
		? { forked_from: { kind: upstream.kind, slug: upstream.slug, author: upstream.author || null }, repo_url: upstream.repo_url || null, upstream_license: upstream.license?.spdx || null }
		: null;
	const [saved] = await sql`
		INSERT INTO skill_publications
			(user_id, skill_id, slug, name, description, author, tags, category, license, version, content, content_sha256, attribution)
		VALUES
			(${userId}, ${row.id}, ${slug}, ${pub.name}, ${pub.description}, ${author}, ${pub.tags}, ${category}, ${license},
			 ${pub.version}, ${pub.content}, ${contentSha}, ${attribution ? JSON.stringify(attribution) : null}::jsonb)
		ON CONFLICT (slug) DO UPDATE SET
			name = EXCLUDED.name, description = EXCLUDED.description, author = EXCLUDED.author, tags = EXCLUDED.tags,
			category = EXCLUDED.category, license = EXCLUDED.license, version = EXCLUDED.version, content = EXCLUDED.content,
			content_sha256 = EXCLUDED.content_sha256, attribution = EXCLUDED.attribution, updated_at = now(), unpublished_at = NULL
		WHERE skill_publications.user_id = ${userId}
		RETURNING slug, content_sha256, updated_at, published_at`;
	if (!saved) throw new CustomSkillError(409, 'slug_taken', 'that public slug belongs to someone else');
	forgetIndex('published');
	return {
		slug: saved.slug,
		sha256: saved.content_sha256,
		published_at: saved.published_at,
		updated_at: saved.updated_at,
		gated: scan.gated,
		url: `${PUBLIC_ORIGIN}/api/skill-imports/published/${saved.slug}/SKILL.md`,
		manifest: `${PUBLIC_ORIGIN}/api/skill-imports/published/manifest.json`,
		page: `/skills/import?registry=published&skill=${saved.slug}`,
	};
}

export async function unpublishSkill(userId, slug) {
	const rows = await sql`
		UPDATE skill_publications SET unpublished_at = now()
		WHERE slug = ${slug} AND user_id = ${userId} AND unpublished_at IS NULL RETURNING slug`;
	if (!rows.length) throw new CustomSkillError(404, 'not_found', 'no live publication with that slug is yours');
	forgetIndex('published');
	return { unpublished: true, slug };
}

export async function listMyPublications(userId) {
	return sql`
		SELECT slug, name, category, license, version, skill_id, content_sha256 AS sha256, published_at, updated_at, unpublished_at
		FROM skill_publications WHERE user_id = ${userId} ORDER BY updated_at DESC`;
}

