import { describe, it, expect } from 'vitest';
import { fileHref, sandboxProgram, sandboxStepHTML } from '../src/shared/sandbox-step-view.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

describe('sandbox step view', () => {
	it('shows the program of an execute_code call', () => {
		const html = sandboxStepHTML({ kind: 'tool_call', tool: 'execute_code', input: { language: 'python', code: 'print(sum(range(10)))' } }, esc);
		expect(html).toContain('python');
		expect(html).toContain('print(sum(range(10)))');
	});

	it('shows exit code, duration, output and files of a result', () => {
		const html = sandboxStepHTML(
			{
				kind: 'tool_result',
				tool: 'execute_code',
				output: {
					status: 'succeeded',
					exit_code: 0,
					stdout: '45\n',
					stderr: '',
					wall_ms: 1500,
					files_changed: [{ path: 'out/chart.png', size: 2048, url: 'https://three.ws/api/sandbox/file?run=r1&path=out%2Fchart.png' }],
				},
			},
			esc,
		);
		expect(html).toContain('Succeeded');
		expect(html).toContain('exit 0');
		expect(html).toContain('1.50 s');
		expect(html).toContain('45');
		expect(html).toContain('href="/api/sandbox/file?run=r1&amp;path=out%2Fchart.png"');
		expect(html).toContain('2.0 KB');
	});

	it('escapes whatever the program printed', () => {
		const html = sandboxStepHTML({ kind: 'tool_result', tool: 'terminal', output: { status: 'failed', exit_code: 1, stdout: '<img src=x onerror=alert(1)>', stderr: '' } }, esc);
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
	});

	it('links only owner file routes', () => {
		expect(fileHref('https://evil.example/steal')).toBeNull();
		expect(fileHref('javascript:alert(1)')).toBeNull();
		expect(fileHref('https://three.ws/api/other?x=1')).toBeNull();
		expect(fileHref('/api/sandbox/file?run=a&path=b')).toBe('/api/sandbox/file?run=a&path=b');
	});

	it('renders a refusal result and ignores non-sandbox steps', () => {
		expect(sandboxStepHTML({ kind: 'tool_result', tool: 'execute_code', output: { error: 'plan limit reached', code: 'limit' } }, esc)).toContain('plan limit reached');
		expect(sandboxStepHTML({ kind: 'tool_call', tool: 'swap_quote', input: {} }, esc)).toBe('');
		expect(sandboxProgram({ kind: 'tool_result', tool: 'execute_code' })).toBeNull();
	});
});
