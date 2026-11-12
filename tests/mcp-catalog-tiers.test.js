// Catalog tier rules against the tool names the vendors actually serve.
// The name classifier defaults anything it does not recognise to "write", which
// is right for an unknown server but leaves a vetted read-only server with no
// tools on. A catalog entry fixes that with explicit tiers; these cases pin the
// names each vendor served when the entry was last checked against it live.

import { describe, expect, it } from 'vitest';
import { getCatalogEntry } from '../api/_lib/mcp-connections/catalog.js';
import { classifyTool, defaultEnabledTools, classifyTools } from '../api/_lib/mcp-connections/classify.js';

describe('Hugging Face catalog tiers', () => {
	// Served by https://huggingface.co/mcp without a token on 2026-11-12. hf_fs
	// only accepts ls, cat, attach, stat, find and search.
	const LIVE = ['hf_whoami', 'hub_repo_search', 'hub_repo_details', 'hf_fs'];
	const rules = getCatalogEntry('hugging-face').tiers;

	it('turns every read tool on for a new connection', () => {
		const classified = classifyTools(LIVE.map((name) => ({ name })), { rules });
		expect(defaultEnabledTools(classified).sort()).toEqual([...LIVE].sort());
	});

	it('still holds back a tool the vendor adds later until someone reviews it', () => {
		expect(classifyTool({ name: 'hub_repo_create' }, { rules }).tier).toBe('write');
	});
});
