// scripts/check-kit-links.mjs is what the owner runs on the send day of a
// partner kit. Its value rests entirely on extraction: a link it fails to find
// is a dead link it can never report, and a fragment it mistakes for a link is
// a false alarm that teaches people to ignore it. These cases pin both sides.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractLinks } from '../scripts/check-kit-links.mjs';

const urls = (md) => extractLinks(md).map((l) => l.url);

describe('extractLinks', () => {
	it('finds inline links and images, with their kind and line', () => {
		const md = [
			'Read [the docs](https://three.ws/docs/solana) first.',
			'![shot](images/docs-solana-failover.png "Failover table")',
			'Source: [connection.js](../../api/_lib/solana/connection.js#L200).',
			'Blog: [post](/blog/three-ws-quicknode-startup-program).',
		].join('\n');
		expect(extractLinks(md)).toEqual([
			{ url: 'https://three.ws/docs/solana', kind: 'http', line: 1 },
			{ url: 'images/docs-solana-failover.png', kind: 'file', line: 2 },
			{ url: '../../api/_lib/solana/connection.js#L200', kind: 'file', line: 3 },
			{ url: '/blog/three-ws-quicknode-startup-program', kind: 'site', line: 4 },
		]);
	});

	it('finds bare and autolinked URLs, including inside fenced post copy', () => {
		const md = [
			'Program page: https://www.quicknode.com/startup (read 2026-11-04)',
			'Autolink: <https://github.com/nirholas/three.ws>.',
			'```text',
			'The code: https://github.com/nirholas/three.ws/blob/main/api/_lib/solana/connection.js',
			'```',
		].join('\n');
		expect(urls(md)).toEqual([
			'https://www.quicknode.com/startup',
			'https://github.com/nirholas/three.ws',
			'https://github.com/nirholas/three.ws/blob/main/api/_lib/solana/connection.js',
		]);
	});

	it('strips trailing sentence punctuation and markup but keeps balanced parens and query strings', () => {
		const md = [
			'Go to https://three.ws/docs/solana?utm_source=x&utm_medium=social.',
			'**https://three.ws/api/healthz**, then `https://three.ws/api/version`;',
			'See https://en.wikipedia.org/wiki/Failover_(computing) for background.',
			'(also https://three.ws/partners)',
		].join('\n');
		expect(urls(md)).toEqual([
			'https://three.ws/docs/solana?utm_source=x&utm_medium=social',
			'https://three.ws/api/healthz',
			'https://three.ws/api/version',
			'https://en.wikipedia.org/wiki/Failover_(computing)',
			'https://three.ws/partners',
		]);
	});

	it('dedupes a URL that appears as both a markdown link and bare text, keeping the first line', () => {
		const md = '[docs](https://three.ws/docs/solana)\nhttps://three.ws/docs/solana again';
		expect(extractLinks(md)).toEqual([{ url: 'https://three.ws/docs/solana', kind: 'http', line: 1 }]);
	});

	it('ignores anchors, mail and phone links, other schemes, template placeholders and elided URLs', () => {
		const md = [
			'[top](#claims-check) [mail](mailto:partners@three.ws) [call](tel:+15555550100)',
			'socket wss://livekit.example.test and [pin](ipfs:bafysynthetic)',
			'Template: https://rpc.example.test/?api-key=${key}',
			'Fill `[program contact first name]` before sending.',
			'Elided: https://three.ws/docs/solana?utm_source=github&...&utm_content=discussion',
		].join('\n');
		expect(urls(md)).toEqual([]);
	});

	it('extracts every link the November Quicknode kit ships with', () => {
		const md = readFileSync(new URL('../marketing/growth/kits/MKT-2026-11-QUICKNODE.md', import.meta.url), 'utf8');
		const found = urls(md);
		expect(found).toContain('https://www.quicknode.com/contact-us');
		expect(found).toContain(
			'https://three.ws/docs/solana?utm_source=quicknode&utm_medium=email&utm_campaign=mkt-2026-11-quicknode&utm_content=field-note',
		);
		expect(found).toContain('../../partner-packets/quicknode-rpc-failover-field-note.md');
		for (const u of found) expect(u).not.toMatch(/[)\].,;`*]$/);
	});
});
