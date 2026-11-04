// `x:content prove` films for minutes with the queue loaded in memory, then used
// to write that whole snapshot back. Anything committed to the queue while it
// filmed was silently reverted: on 2026-11-04 a prove run dropped two newly added
// items and rolled back a claim's evidence fix. Saving one item must merge it
// into the queue as it stands on disk at that moment.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUEUE_PATH, loadQueue, saveQueueItem } from '../api/_lib/x-content/queue.js';

function rootWith(queue) {
	const root = mkdtempSync(join(tmpdir(), 'x-queue-'));
	mkdirSync(join(root, 'data/x-content'), { recursive: true });
	writeFileSync(join(root, QUEUE_PATH), `${JSON.stringify(queue, null, '\t')}\n`);
	return root;
}

describe('saveQueueItem', () => {
	it('keeps every change made to the queue on disk after the item was loaded', () => {
		const root = rootWith({ quality: { glossary: [] }, items: [{ id: 'a', note: 'old' }, { id: 'b', note: 'old' }] });
		const filmed = structuredClone(loadQueue(root).items[0]);
		filmed.posts = [{ text: 'head', media: [{ path: 'reel.mp4', alt: 'reel' }] }];

		// Another author commits while the reel is being filmed.
		const meanwhile = loadQueue(root);
		meanwhile.items[1].note = 'new';
		meanwhile.items.push({ id: 'c' });
		meanwhile.quality.glossary.push('three.ws');
		writeFileSync(join(root, QUEUE_PATH), `${JSON.stringify(meanwhile, null, '\t')}\n`);

		saveQueueItem(root, filmed);

		const saved = loadQueue(root);
		expect(saved.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
		expect(saved.items[0].posts[0].media[0].path).toBe('reel.mp4');
		expect(saved.items[1].note).toBe('new');
		expect(saved.quality.glossary).toEqual(['three.ws']);
		expect(readFileSync(join(root, QUEUE_PATH), 'utf8').endsWith('}\n')).toBe(true);
	});

	it('refuses an item that is no longer in the queue instead of resurrecting it', () => {
		const root = rootWith({ items: [{ id: 'a' }] });
		expect(() => saveQueueItem(root, { id: 'gone' })).toThrow(/gone/);
		expect(loadQueue(root).items).toEqual([{ id: 'a' }]);
	});
});
