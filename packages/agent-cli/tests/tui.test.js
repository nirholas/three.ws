// The Ink TUI rendered with ink-testing-library against a local streaming
// model server: a streamed reply, a write tool approved with Enter and one
// denied with Esc, Ctrl+C stopping a turn mid-stream, typing during a turn to
// redirect it, and the status line.

import fs from 'node:fs';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createSession } from '../src/session.js';
import { App } from '../src/tui/app.js';
import { modelServer, tempEnv, testContext, waitFor } from './helpers.js';

const ENTER = '\r';
const ESC = '\x1b';
const CTRL_C = '\x03';

const cleanups = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()();
});

async function mount(reply) {
	const t = tempEnv();
	const srv = await modelServer(reply);
	const ctx = testContext(t.env, srv.baseUrl);
	const session = createSession(ctx);
	const app = render(h(App, { ctx, session, scheduler: false }));
	cleanups.push(t.cleanup, srv.close, () => ctx.close(), () => app.unmount());
	const frame = () => app.lastFrame() || '';
	const type = async (text) => {
		app.stdin.write(text);
		await waitFor(() => frame().includes(text.split('\n').at(-1)));
	};
	const press = async (key) => {
		app.stdin.write(key);
		await new Promise((r) => setTimeout(r, 30));
	};
	const send = async (text) => {
		await type(text);
		await press(ENTER);
	};
	return { t, srv, ctx, session, app, frame, type, press, send };
}

describe('TUI', () => {
	it('streams a reply and shows the model, session and tokens in the status line', async () => {
		const ui = await mount(() => ({ content: 'High tide is at 06:42 and again at 19:05.', chunkDelayMs: 15 }));
		expect(ui.frame()).toContain(`session ${ui.session.id}`);
		await ui.send('when is high tide');
		await waitFor(() => ui.frame().includes('Ctrl+C stops'));
		await waitFor(() => ui.frame().includes('High tide is at 06:42 and again at 19:05.') && !ui.frame().includes('Ctrl+C stops'));
		const f = ui.frame();
		expect(f).toContain('> when is high tide');
		expect(f).toContain('test-model');
		expect(f).toContain('15 tokens');
		expect(f).toContain('  |  ');
		expect(ui.srv.requests[0].messages.at(-1)).toEqual({ role: 'user', content: 'when is high tide' });
		expect(ui.ctx.store.getSession(ui.session.id)).toBeTruthy();
	});

	it('runs a write after Enter approves it and skips it after Esc denies it', async () => {
		const ui = await mount((body) => {
			const last = body.messages.at(-1);
			if (last.role === 'tool') return { content: last.content.includes('blocked') || last.content.includes('denied') ? 'Left the file alone.' : 'Wrote the note.' };
			return { toolCalls: [{ name: 'write_file', args: { path: last.content.includes('deny') ? 'denied.txt' : 'approved.txt', content: 'tide at 06:42' } }] };
		});

		await ui.send('save the tide note');
		await waitFor(() => ui.frame().includes('Approve write tool write_file?'));
		expect(ui.frame()).toContain('Enter approve');
		await ui.press(ENTER);
		await waitFor(() => ui.frame().includes('Wrote the note.'));
		expect(fs.readFileSync(path.join(ui.t.cwd, 'approved.txt'), 'utf8')).toBe('tide at 06:42');
		expect(ui.frame()).toMatch(/\+ write_file \d+ms/);

		await ui.send('save it again but deny');
		await waitFor(() => ui.frame().split('Approve write tool write_file?').length === 2 && ui.srv.requests.length === 3);
		await ui.press(ESC);
		await waitFor(() => ui.frame().includes('Left the file alone.'));
		expect(fs.existsSync(path.join(ui.t.cwd, 'denied.txt'))).toBe(false);
		expect(ui.frame()).toMatch(/- write_file not run/);
	});

	it('stops a streaming turn on Ctrl+C and keeps the partial reply', async () => {
		let release;
		const hold = new Promise((r) => {
			release = r;
		});
		const ui = await mount(() => ({ content: 'Counting the boats in the harbour one by one', chunkDelayMs: 10, hold }));
		cleanups.push(async () => release());
		await ui.send('count the boats');
		await waitFor(() => ui.frame().includes('one by one'));
		await ui.press(CTRL_C);
		await waitFor(() => ui.frame().includes('Stopped. The partial reply is kept in the session.'));
		expect(ui.frame()).not.toContain('Ctrl+C stops');
		const saved = ui.ctx.store.exportSession(ui.session.id).messages;
		expect(saved.some((m) => m.role === 'assistant' && m.content.includes('Counting the boats'))).toBe(true);
	});

	it('redirects a running turn with what was typed during it', async () => {
		let release;
		const hold = new Promise((r) => {
			release = r;
		});
		const ui = await mount((body, n) => (n === 1 ? { content: 'Drafting the long version', hold } : { content: `Short version: ${body.messages.at(-1).content}` }));
		cleanups.push(async () => release());
		await ui.send('write the harbour report');
		await waitFor(() => ui.frame().includes('Drafting the long version'));
		await ui.send('make it two lines');
		await waitFor(() => ui.frame().includes('Short version: make it two lines'));
		expect(ui.frame()).toContain('Stopped; redirecting.');
		expect(ui.srv.requests).toHaveLength(2);
		expect(ui.srv.requests[1].messages.at(-1)).toEqual({ role: 'user', content: 'make it two lines' });
	});

	it('autocompletes a slash command with Tab and prints /help', async () => {
		const ui = await mount(() => ({ content: 'unused' }));
		await ui.type('/he');
		await ui.press('\t');
		await waitFor(() => ui.frame().includes('/help '));
		await ui.press(ENTER);
		await waitFor(() => ui.frame().includes('Enter approves, Esc denies'));
		expect(ui.srv.requests).toHaveLength(0);
	});
});
