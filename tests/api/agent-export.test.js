// Portable agent config (api/_lib/agents-v1/agent-export.js). The export must
// never carry what identifies or funds an agent, and an import must never
// authorize spending on its own: swap and transfer automations need both
// `confirm: true` and a caller holding wallet:write.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../../api/_lib/db.js', () => ({ sql: sqlMock, isDbUnavailableError: () => false, isDbCapacityError: () => false }));

const createAgentMock = vi.fn();
const loadOwnedAgentMock = vi.fn();
const updateAgentMock = vi.fn();
vi.mock('../../api/_lib/agents-v1/agents.js', async (importOriginal) => ({
	...(await importOriginal()),
	createAgent: (...a) => createAgentMock(...a),
	loadOwnedAgent: (...a) => loadOwnedAgentMock(...a),
	updateAgent: (...a) => updateAgentMock(...a),
}));

const createAutomationMock = vi.fn();
const getAutomationMock = vi.fn();
const updateAutomationMock = vi.fn();
vi.mock('../../api/_lib/agents-v1/automations.js', async (importOriginal) => ({
	...(await importOriginal()),
	createAutomation: (...a) => createAutomationMock(...a),
	getAutomation: (...a) => getAutomationMock(...a),
	updateAutomation: (...a) => updateAutomationMock(...a),
}));

const listSkillsMock = vi.fn();
const createSkillMock = vi.fn();
const importCommunitySkillMock = vi.fn();
vi.mock('../../api/_lib/agent-custom-skills.js', async (importOriginal) => ({
	...(await importOriginal()),
	listSkills: (...a) => listSkillsMock(...a),
	createSkill: (...a) => createSkillMock(...a),
	importCommunitySkill: (...a) => importCommunitySkillMock(...a),
}));

const { exportAgent, importAgent, EXPORT_FORMAT, EXPORT_VERSION } = await import('../../api/_lib/agents-v1/agent-export.js');

const USER = 'user-export-1';
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_AGENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const agentRow = {
	id: AGENT,
	user_id: USER,
	name: 'Scout',
	description: 'Watches new launches',
	persona_prompt: 'Be terse.',
	skills: ['market-data'],
	wallet_address: '0x1111111111111111111111111111111111111111',
	meta: {
		runtime: { model: 'gpt-4o-mini', temperature: 0.2 },
		solana_address: 'THREEsynthetic11111111111111111111111111111',
		encrypted_solana_secret: 'ciphertext',
	},
};

function doc(automations = [], customSkills = []) {
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		agent: { name: 'Scout', persona: 'Watches new launches', systemPrompt: 'Be terse.', model: 'gpt-4o-mini', temperature: 0.2, skills: [] },
		automations,
		customSkills,
	};
}

const notify = { title: 'Morning brief', trigger: { type: 'schedule', cron: '0 9 * * *' }, action: { type: 'notify', message: 'gm' } };
const swap = { title: 'DCA', trigger: { type: 'schedule', cron: '0 * * * *' }, action: { type: 'swap', amountSol: 0.01 } };

beforeEach(() => {
	for (const m of [sqlMock, createAgentMock, loadOwnedAgentMock, updateAgentMock, createAutomationMock, getAutomationMock, updateAutomationMock, listSkillsMock, createSkillMock, importCommunitySkillMock]) m.mockReset();
	createAgentMock.mockResolvedValue({ agent: { id: NEW_AGENT, name: 'Scout' } });
	sqlMock.mockResolvedValue([{ id: NEW_AGENT, user_id: USER }]);
	createAutomationMock.mockImplementation(async ({ body }) => ({ id: `auto-${body.title}`, title: body.title }));
});

describe('exportAgent', () => {
	it('exports settings, automations and skills with no wallet or key material', async () => {
		sqlMock.mockResolvedValueOnce([
			{ id: 'a1', title: 'Morning brief', trigger_config: notify.trigger, action_config: notify.action, trigger_once: false, enabled: true, intent_id: null },
		]);
		listSkillsMock.mockResolvedValue({
			skills: [
				{ source: 'community', source_slug: 'pump-scanner', enabled: true, name: 'Pump scanner', content: 'x' },
				{ source: 'custom', name: 'Notes', description: 'd', content: '# Notes', tags: ['a'], version: '1.2.0', enabled: false },
			],
		});

		const out = await exportAgent(agentRow);
		expect(out).toMatchObject({ format: EXPORT_FORMAT, version: EXPORT_VERSION, source: { agentId: AGENT } });
		expect(out.agent).toMatchObject({ name: 'Scout', persona: 'Watches new launches', systemPrompt: 'Be terse.', model: 'gpt-4o-mini' });
		expect(out.automations).toEqual([{ title: 'Morning brief', trigger: notify.trigger, action: notify.action, triggerOnce: false, enabled: true }]);
		expect(out.customSkills).toEqual([
			{ source: 'community', slug: 'pump-scanner', enabled: true },
			{ source: 'custom', name: 'Notes', description: 'd', content: '# Notes', tags: ['a'], version: '1.2.0', enabled: false },
		]);

		const text = JSON.stringify(out);
		expect(text).not.toContain(agentRow.wallet_address);
		expect(text).not.toContain(agentRow.meta.solana_address);
		expect(text).not.toContain('ciphertext');
		expect(out.agent.wallet).toBeUndefined();
	});
});

describe('importAgent', () => {
	it('rejects a document with the wrong format or version', async () => {
		await expect(importAgent(USER, { format: 'other' }, { canSpend: false })).rejects.toMatchObject({ status: 400, code: 'invalid_document' });
		await expect(importAgent(USER, { ...doc(), version: 99 }, { canSpend: false })).rejects.toMatchObject({ status: 400, code: 'unsupported_version' });
		expect(createAgentMock).not.toHaveBeenCalled();
	});

	it('skips a spend automation for a caller without wallet:write', async () => {
		const out = await importAgent(USER, { document: doc([notify, swap]), confirm: true }, { canSpend: false });
		expect(out.automations.map((a) => a.title)).toEqual(['Morning brief']);
		expect(out.skipped).toEqual([{ kind: 'automation', index: 1, title: 'DCA', reason: 'insufficient_scope' }]);
		expect(createAutomationMock).toHaveBeenCalledTimes(1);
	});

	it('skips a spend automation when the import is not confirmed', async () => {
		const out = await importAgent(USER, doc([swap]), { canSpend: true });
		expect(out.skipped).toEqual([{ kind: 'automation', index: 0, title: 'DCA', reason: 'confirmation_required' }]);
		expect(createAutomationMock).not.toHaveBeenCalled();
	});

	it('creates a confirmed spend automation for a wallet:write caller, passing confirm through', async () => {
		const out = await importAgent(USER, { document: doc([swap]), confirm: true }, { canSpend: true });
		expect(out.skipped).toEqual([]);
		expect(createAutomationMock).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, source: 'import', body: expect.objectContaining({ title: 'DCA', confirm: true }) }));
	});

	it('restores a disabled automation as disabled and reports a bad custom skill without failing', async () => {
		updateAutomationMock.mockResolvedValue({ id: 'auto-Morning brief', title: 'Morning brief', enabled: false });
		const out = await importAgent(USER, { document: doc([{ ...notify, enabled: false }], [{ source: 'custom', name: '' }]), name: 'Scout copy' }, { canSpend: false });
		expect(createAgentMock).toHaveBeenCalledWith(USER, expect.objectContaining({ name: 'Scout copy' }));
		expect(updateAutomationMock).toHaveBeenCalledWith({ userId: USER, id: 'auto-Morning brief', body: { enabled: false } });
		expect(out.automations[0].enabled).toBe(false);
		expect(out.skipped).toEqual([expect.objectContaining({ kind: 'custom_skill', index: 0, reason: 'validation_error' })]);
		expect(createSkillMock).not.toHaveBeenCalled();
	});
});
