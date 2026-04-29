/**
 * Converts a JSON Schema properties object into the simplified args map.
 * Required properties → 'type', optional → 'type?'
 *
 * @param {Object|undefined} inputSchema
 * @returns {Record<string, string>}
 */
function schemaToArgs(inputSchema) {
	if (!inputSchema?.properties) return {};
	const required = new Set(inputSchema.required || []);
	const args = {};
	for (const [key, prop] of Object.entries(inputSchema.properties)) {
		const type = prop.type || 'any';
		args[key] = required.has(key) ? type : `${type}?`;
	}
	return args;
}

/**
 * Build a portable skill manifest from a list of SkillDef objects.
 * Skills without a description are omitted with a console.warn.
 *
 * @param {{ agentId: string, version: string, skills: Array }} opts
 * @returns {{ agent: { id: string, version: string }, skills: Array }}
 */
export function buildSkillManifest({ agentId, version, skills }) {
	const entries = [];
	for (const skill of skills) {
		if (!skill.description) {
			console.warn(`[skill-manifest] Skill "${skill.name}" has no description — omitting`);
			continue;
		}
		entries.push({
			name: skill.name,
			description: skill.description,
			args: schemaToArgs(skill.inputSchema),
		});
	}
	return {
		agent: { id: agentId, version },
		skills: entries,
	};
}
