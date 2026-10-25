import { describe, it, expect } from 'vitest';
import http from 'node:http';
import axios from 'axios';
import { createGuardedAgents } from '../mcp-bridge/src/url-guard.js';

describe('mcp-bridge url-guard: connect-time DNS pinning', () => {
	it('refuses a hostname that resolves to loopback at connect time', async () => {
		let hit = false;
		const server = http.createServer((_req, res) => {
			hit = true;
			res.end('internal');
		});
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		const { port } = server.address();
		try {
			// "localhost" stands in for a rebinding name whose second answer is internal.
			await expect(
				axios.get(`http://localhost:${port}/`, { ...createGuardedAgents(), maxRedirects: 0 }),
			).rejects.toThrow(/private\/blocked/);
			expect(hit).toBe(false);
		} finally {
			server.close();
		}
	});
});
