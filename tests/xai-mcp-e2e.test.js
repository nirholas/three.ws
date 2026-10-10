// The xAI Responses API remote-MCP proof (order 039): request shape, response
// parsing and key resolution, pinned so a field rename in the script cannot
// quietly stop matching xAI's documented request or our server's response.
import { describe, it, expect, afterEach } from 'vitest';
import { parseArgs, buildRequest, mcpCalls, finalText, matchesToolName, resolveKey } from '../scripts/xai-mcp-e2e.mjs';

describe('parseArgs', () => {
	it('defaults to the Grok connector server and the catalog-chair prompt', () => {
		const args = parseArgs([]);
		expect(args.server).toBe('mcp-grok');
		expect(args.base).toBe('https://three.ws');
		expect(args.dryRun).toBe(false);
		expect(args.prompt).toMatch(/chair/i);
	});

	it('reads every flag', () => {
		const args = parseArgs(['--dry-run', '--server', 'mcp-studio', '--base', 'http://localhost:3107', '--model', 'grok-4.3', '--prompt', 'hi', '--allow-tools', 'search_catalog, get_job']);
		expect(args).toMatchObject({ dryRun: true, server: 'mcp-studio', base: 'http://localhost:3107', model: 'grok-4.3', prompt: 'hi' });
		expect(args.allowTools).toEqual(['search_catalog', 'get_job']);
	});

	it('rejects an unknown server', () => {
		expect(() => parseArgs(['--server', 'mcp-nope'])).toThrow(/unknown --server/);
	});
});

describe('buildRequest', () => {
	it('matches xAI\'s documented remote MCP tool shape field for field', () => {
		const req = buildRequest(parseArgs(['--base', 'https://three.ws']));
		expect(req.tools).toHaveLength(1);
		const tool = req.tools[0];
		expect(tool.type).toBe('mcp');
		expect(tool.server_url).toBe('https://three.ws/api/mcp-grok');
		expect(tool.server_label).toBe('three-ws');
		expect(tool.allowed_tools).toBeUndefined();
		expect(req.input).toEqual([{ role: 'user', content: expect.stringContaining('chair') }]);
	});

	it('points mcp-studio at the free studio server, not the grok one', () => {
		const req = buildRequest(parseArgs(['--server', 'mcp-studio']));
		expect(req.tools[0].server_url).toBe('https://three.ws/api/mcp-studio');
	});

	it('strips a trailing slash from --base', () => {
		const req = buildRequest(parseArgs(['--base', 'http://localhost:3107/']));
		expect(req.tools[0].server_url).toBe('http://localhost:3107/api/mcp-grok');
	});

	it('only sets allowed_tools when given one', () => {
		const req = buildRequest(parseArgs(['--allow-tools', 'search_catalog']));
		expect(req.tools[0].allowed_tools).toEqual(['search_catalog']);
	});
});

describe('mcpCalls / matchesToolName', () => {
	it('picks out mcp_call output items and matches a bare or server-prefixed name', () => {
		const output = [
			{ type: 'reasoning' },
			{ type: 'mcp_call', name: 'search_catalog', server_label: 'three-ws' },
			{ type: 'mcp_call', name: 'three-ws.get_job', server_label: 'three-ws' },
		];
		const calls = mcpCalls(output);
		expect(calls).toHaveLength(2);
		expect(matchesToolName(calls[0], 'search_catalog')).toBe(true);
		expect(matchesToolName(calls[1], 'get_job')).toBe(true);
		expect(matchesToolName(calls[0], 'get_job')).toBe(false);
	});

	it('returns no calls when the output has none', () => {
		expect(mcpCalls([{ type: 'message' }])).toEqual([]);
		expect(mcpCalls(null)).toEqual([]);
	});
});

describe('finalText', () => {
	it('joins output_text parts of the final assistant message', () => {
		const output = [
			{ type: 'mcp_call', name: 'search_catalog' },
			{
				type: 'message',
				role: 'assistant',
				content: [{ type: 'output_text', text: 'Here is a chair: https://three.ws/object/adjustable-chair' }],
			},
		];
		expect(finalText(output)).toContain('three.ws/object/adjustable-chair');
	});

	it('ignores non-assistant messages and non-text content', () => {
		const output = [
			{ type: 'message', role: 'user', content: [{ type: 'output_text', text: 'ignored' }] },
			{ type: 'message', role: 'assistant', content: [{ type: 'reasoning_text', text: 'ignored too' }] },
		];
		expect(finalText(output)).toBe('');
	});
});

describe('resolveKey', () => {
	const KEYS = ['GROK_API_KEY', 'XAI_API_KEY'];
	const saved = {};
	afterEach(() => {
		for (const k of KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
			delete saved[k];
		}
	});

	it('prefers GROK_API_KEY from the environment over XAI_API_KEY', () => {
		for (const k of KEYS) saved[k] = process.env[k];
		process.env.GROK_API_KEY = 'grok-key';
		process.env.XAI_API_KEY = 'xai-key';
		expect(resolveKey()).toEqual({ key: 'grok-key', source: 'process.env' });
	});

	it('falls back to XAI_API_KEY', () => {
		for (const k of KEYS) saved[k] = process.env[k];
		delete process.env.GROK_API_KEY;
		process.env.XAI_API_KEY = 'xai-key';
		expect(resolveKey()).toEqual({ key: 'xai-key', source: 'process.env' });
	});
});
