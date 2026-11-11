// split-progress-log keeps a prompts/ handoff log under the paste limit by
// moving its oldest entries, verbatim, into archive parts. Nothing may be lost,
// undated policy sections stay live, and every output file fits the limit.
import { describe, expect, it } from 'vitest';
import { PROMPT_CHAR_LIMIT, charCount, splitProgressLog } from '../scripts/split-progress-log.mjs';

const body = (n) => `${'measured and shipped. '.repeat(Math.ceil(n / 22))}`.trim();
const nonEmptyLines = (...texts) =>
	texts
		.flatMap((t) => t.split('\n'))
		.filter((l) => l.trim())
		.sort();

function headingLog(entries) {
	const out = ['# demo progress log', '', 'Append one dated entry per session. Newest at the bottom.', '', '```', '## <date>: <order>', '```', ''];
	entries.forEach((e) => out.push(e.head, '', e.text, ''));
	return out.join('\n');
}

describe('splitProgressLog', () => {
	it('returns null when the log already fits', () => {
		expect(splitProgressLog(headingLog([{ head: '## 2026-11-01: a', text: 'short' }]), { baseName: 'demo-PROGRESS', today: '2026-11-10' })).toBeNull();
	});

	it('archives the oldest heading entries verbatim and keeps the newest live', () => {
		const entries = Array.from({ length: 30 }, (_, i) => ({
			head: `## 2026-10-${String(i + 1).padStart(2, '0')}: order ${i + 1}`,
			text: body(3_000),
		}));
		entries.splice(10, 0, { head: '## Retire this file when the campaign is done', text: 'policy text' });
		const log = headingLog(entries);
		const r = splitProgressLog(log, { baseName: 'demo-PROGRESS', today: '2026-11-10' });

		expect(r).not.toBeNull();
		expect(charCount(r.live)).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
		for (const a of r.archives) expect(charCount(a.text)).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
		expect(r.live).toContain('## 2026-10-30: order 30');
		expect(r.live).not.toContain('## 2026-10-01: order 1\n');
		expect(r.live).toContain('## Retire this file when the campaign is done');
		expect(r.live).toContain('## <date>: <order>'); // the fenced template is preamble, not an entry
		expect(r.live).toMatch(/\*\*Older entries:\*\* \[demo-PROGRESS-archive-1\.md\]\(demo-PROGRESS-archive-1\.md\)/);

		const added = new Set(nonEmptyLines(r.live, ...r.archives.map((a) => a.text)));
		for (const line of nonEmptyLines(log)) expect(added.has(line)).toBe(true);
	});

	it('splits a log written as one dated line per entry', () => {
		const lines = ['# plan- progress log', '', 'One dated line per order.', ''];
		for (let i = 0; i < 200; i += 1) lines.push(`2026-11-${String((i % 28) + 1).padStart(2, '0')} | order-${i}.md | abc123 | ${body(300)}`);
		const log = lines.join('\n');
		const r = splitProgressLog(log, { baseName: 'plan-PROGRESS', today: '2026-11-10' });
		expect(charCount(r.live)).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
		expect(r.live.split('\n')[0]).toBe('# plan- progress log');
		expect(r.live.indexOf('**Older entries:**')).toBeLessThan(r.live.indexOf('| order-'));
		const kept = nonEmptyLines(r.live, ...r.archives.map((a) => a.text));
		for (const line of nonEmptyLines(log)) expect(kept).toContain(line);
	});

	it('continues archive numbering and keeps earlier archive links on a re-split', () => {
		const entries = Array.from({ length: 30 }, (_, i) => ({ head: `## 2026-10-${String(i + 1).padStart(2, '0')}: o${i}`, text: body(3_000) }));
		const first = splitProgressLog(headingLog(entries), { baseName: 'demo-PROGRESS', today: '2026-11-10' });
		const grown = `${first.live}${Array.from({ length: 10 }, (_, i) => `\n## 2026-11-${String(i + 1).padStart(2, '0')}: n${i}\n\n${body(3_000)}\n`).join('')}`;
		const second = splitProgressLog(grown, { baseName: 'demo-PROGRESS', firstIndex: first.archives.length + 1, today: '2026-11-11' });
		expect(second.archives[0].index).toBe(first.archives.length + 1);
		expect(second.live).toContain('[demo-PROGRESS-archive-1.md](demo-PROGRESS-archive-1.md)');
		expect(second.live).toContain(`[demo-PROGRESS-archive-${first.archives.length + 1}.md]`);
		expect(second.live.match(/\*\*Older entries:\*\*/g)).toHaveLength(1);
	});
});
