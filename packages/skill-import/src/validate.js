// Validate a generated skill bundle before it is ever saved or served.
//
// community-skills/tools/validate.mjs validates a different, incompatible
// directory shape (SKILL.md + metadata.json only; it rejects any other
// top-level file, so it cannot see a manifest.json/tools.json/handlers.js
// bundle at all). This validator checks the actual bundle shape
// specs/SKILL_SPEC.md defines, structurally mirroring the checks
// tests/src/pump-fun-skill.test.js makes of the built-in pump-fun skill,
// while still reusing registry.mjs's no-other-coin and token-budget
// primitives rather than re-implementing them.

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { findTokenReferences, estimateTokens, LIMITS } from '../../../community-skills/tools/registry.mjs';

export class SkillBundleValidationError extends Error {
	constructor(errors) {
		super(`invalid skill bundle:\n- ${errors.join('\n- ')}`);
		this.errors = errors;
	}
}

function checkSyntax(source) {
	const file = join(tmpdir(), `skill-import-${randomUUID()}.mjs`);
	writeFileSync(file, source);
	try {
		const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
		if (result.status !== 0) return [`handlers.js has a syntax error: ${result.stderr.trim()}`];
		return [];
	} finally {
		unlinkSync(file);
	}
}

/**
 * @param {{manifest: object, skillMd: string, tools?: object, handlersSrc?: string}} bundle
 * @param {{allowAddresses?: string[]}} opts addresses the bundle may contain
 *   verbatim because they are structural data the caller already vetted (an
 *   Anchor IDL's own program id and fixed account addresses), not promotion
 * @returns {string[]} errors; empty means valid
 */
export function validateBundle({ manifest, skillMd, tools, handlersSrc }, { allowAddresses = [] } = {}) {
	const errors = [];

	if (!manifest || manifest.spec !== 'skill/0.1') errors.push('manifest.spec must be "skill/0.1"');
	if (!manifest?.name) errors.push('manifest.name is required');
	if (!manifest?.version) errors.push('manifest.version is required');
	if (!manifest?.description) errors.push('manifest.description is required');
	if (!Array.isArray(manifest?.provides?.tools)) errors.push('manifest.provides.tools must be an array');

	if (!skillMd || !/^---\n/.test(skillMd)) errors.push('SKILL.md must start with --- frontmatter');

	const declaredTools = manifest?.provides?.tools || [];
	if (declaredTools.length > 0) {
		if (!tools || !Array.isArray(tools.tools)) {
			errors.push('tools.json is required when manifest.provides.tools is non-empty');
		} else {
			const toolNames = new Set(tools.tools.map((t) => t.name));
			for (const name of declaredTools) {
				if (!toolNames.has(name)) errors.push(`manifest declares tool "${name}" missing from tools.json`);
			}
			for (const tool of tools.tools) {
				if (!tool.description) errors.push(`tool "${tool.name}" has no description`);
				if (tool.input_schema?.type !== 'object') errors.push(`tool "${tool.name}".input_schema.type must be "object"`);
			}
		}
		if (!handlersSrc) {
			errors.push('handlers.js is required when manifest.provides.tools is non-empty');
		} else {
			for (const name of declaredTools) {
				if (!new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(handlersSrc)) {
					errors.push(`handlers.js has no exported function for tool "${name}"`);
				}
			}
			errors.push(...checkSyntax(handlersSrc));
		}
	} else if (tools || handlersSrc) {
		errors.push('declarative skill (no provides.tools) must not ship tools.json or handlers.js');
	}

	let allText = [skillMd, JSON.stringify(manifest), tools ? JSON.stringify(tools) : ''].join('\n');
	for (const address of allowAddresses) allText = allText.split(address).join('');
	for (const finding of findTokenReferences(allText, { prose: true })) {
		errors.push(`references another crypto project (${finding}); only $THREE is promoted`);
	}
	if (estimateTokens(skillMd) > LIMITS.bodyMaxChars / 4) {
		errors.push(`SKILL.md is too large (~${estimateTokens(skillMd)} tokens, limit ~${Math.ceil(LIMITS.bodyMaxChars / 4)})`);
	}

	return errors;
}

/** Throws SkillBundleValidationError if the bundle is invalid. */
export function assertValidBundle(bundle, opts) {
	const errors = validateBundle(bundle, opts);
	if (errors.length) throw new SkillBundleValidationError(errors);
}
