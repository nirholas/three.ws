// /w/:id (api/widgets/page.js) is the page a crawler indexes for a widget.
// Most widgets keep their default name ("Talking-agent Widget"), so a head
// built from the name alone gave hundreds of pages one title and one
// description. The owner, the subject and the creation date tell them apart.

import { describe, it, expect } from 'vitest';
import { widgetPageMeta } from '../api/widgets/page.js';

const base = { id: 'wdgt_2R4TTLhdjEJ4frRf', name: 'Talking-agent Widget', type: 'talking-agent', created_at: '2026-02-15T10:25:00Z' };

describe('widgetPageMeta', () => {
	it('names the owner in the title and the subject, owner and date in the description', () => {
		const m = widgetPageMeta({ ...base, owner_name: 'Cristian', avatar_name: 'Nova' });
		expect(m.title).toBe('Talking-agent Widget by Cristian, Feb 15, 2026');
		expect(m.desc).toBe('Talking Agent widget featuring Nova by Cristian, made Feb 15, 2026. Embeddable 3D, no code. Powered by three.ws.');
	});

	it('gives two default-named widgets of one type different titles and descriptions', () => {
		const a = widgetPageMeta({ ...base, owner_name: '0x6f75…1C4c' });
		const b = widgetPageMeta({ ...base, id: 'wdgt_kJBu2IWFZRIyxA5m', owner_name: '0x4409…2d36', created_at: '2026-03-30T10:25:00Z' });
		expect(a.title).not.toBe(b.title);
		expect(a.desc).not.toBe(b.desc);
	});

	it('keeps a renamed widget title free of the date', () => {
		const m = widgetPageMeta({ ...base, name: 'Desk Concierge', owner_name: 'Cristian' });
		expect(m.title).toBe('Desk Concierge by Cristian');
	});

	it('separates one owner\'s two default-named widgets of one type by date', () => {
		const a = widgetPageMeta({ ...base, name: 'Kol-trades Widget', type: 'kol-trades', owner_name: 'aiawad', created_at: '2026-02-24T10:25:27Z' });
		const b = widgetPageMeta({ ...base, name: 'Kol-trades Widget', type: 'kol-trades', owner_name: 'aiawad', created_at: '2026-03-12T10:25:27Z' });
		expect(a.title).toBe('Kol-trades Widget by aiawad, Feb 24, 2026');
		expect(a.title).not.toBe(b.title);
	});

	it('does not repeat a subject the widget name already carries', () => {
		const m = widgetPageMeta({ ...base, name: 'Nova Chat', avatar_name: 'Nova', owner_name: 'Nova' });
		expect(m.title).toBe('Nova Chat');
		expect(m.desc).toBe('Talking Agent widget by Nova, made Feb 15, 2026. Embeddable 3D, no code. Powered by three.ws.');
	});

	it('keeps a demo widget with no owner or date readable', () => {
		const m = widgetPageMeta({ id: 'demo', name: 'Turntable Showcase', type: 'turntable' });
		expect(m.title).toBe('Turntable Showcase');
		expect(m.desc).toBe('Turntable Showcase widget. Embeddable 3D, no code. Powered by three.ws.');
	});
});
