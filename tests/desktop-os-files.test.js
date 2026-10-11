// Pure logic behind the native File Explorer, Notepad and Photos apps.
import { describe, it, expect } from 'vitest';
import {
	formatSize, sortNodes, buildCrumbs, parseAddress, filterByName, rangeSelect, moveIndex, movablePaths,
	selectionSummary, statusText, locationName, typeLabel, iconName,
} from '../src/desktop/os/apps/files.js';
import {
	findMatches, replaceAll, nextMatchIndex, lineCol, offsetOfLine, countLines, clampSize, zoomPercent,
	titleFor, fileNameFrom, parseDrafts, MIN_SIZE, MAX_SIZE,
} from '../src/desktop/os/apps/notepad.js';
import {
	newestFirst, byName, stepIndex, fitScale, rotatedSize, clampPan, zoomAt, clampZoom, positionLabel, isImageName,
} from '../src/desktop/os/apps/photos.js';

const f = (name, extra = {}) => ({ type: 'file', name, path: `/Documents/${name}`, parent: '/Documents', size: 10, mtime: 1, ...extra });
const d = (name, extra = {}) => ({ type: 'dir', name, path: `/Documents/${name}`, parent: '/Documents', size: 0, mtime: 1, ...extra });

describe('files: formatting', () => {
	it('formats sizes', () => {
		expect(formatSize(0)).toBe('0 B');
		expect(formatSize(-5)).toBe('0 B');
		expect(formatSize(NaN)).toBe('0 B');
		expect(formatSize(812)).toBe('812 B');
		expect(formatSize(1024)).toBe('1 KB');
		expect(formatSize(1536)).toBe('1.5 KB');
		expect(formatSize(12 * 1024)).toBe('12 KB');
		expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
		expect(formatSize(3 * 1024 ** 3)).toBe('3 GB');
	});
	it('labels types and locations', () => {
		expect(typeLabel(d('a'))).toBe('File folder');
		expect(typeLabel(f('pic.png'))).toBe('PNG file');
		expect(typeLabel(f('README'))).toBe('File');
		expect(locationName('@home')).toBe('Home');
		expect(locationName('/')).toBe('This PC');
		expect(locationName('/Trash')).toBe('Recycle Bin');
		expect(locationName('/Documents/Notes')).toBe('Notes');
	});
	it('picks icons', () => {
		expect(iconName({ type: 'dir', path: '/Pictures', parent: '/', name: 'Pictures' })).toBe('image');
		expect(iconName({ type: 'dir', path: '/Trash', parent: '/', name: 'Trash' })).toBe('trash');
		expect(iconName(d('x'))).toBe('folder');
		expect(iconName(f('a.mp3'))).toBe('music');
		expect(iconName(f('a.txt'))).toBe('note');
		expect(iconName(f('a.bin'))).toBe('fx-file');
	});
});

describe('files: sorting and filtering', () => {
	const nodes = [f('b.txt', { size: 5, mtime: 30 }), d('Zed'), f('a10.txt', { size: 50, mtime: 10 }), f('a2.txt', { size: 1, mtime: 20 }), d('alpha')];
	it('keeps folders first and sorts naturally by name', () => {
		expect(sortNodes(nodes).map((n) => n.name)).toEqual(['alpha', 'Zed', 'a2.txt', 'a10.txt', 'b.txt']);
	});
	it('reverses within each group only', () => {
		expect(sortNodes(nodes, { key: 'name', dir: 'desc' }).map((n) => n.name)).toEqual(['Zed', 'alpha', 'b.txt', 'a10.txt', 'a2.txt']);
	});
	it('sorts by size, date and type without mutating the input', () => {
		const copy = [...nodes];
		expect(sortNodes(nodes, { key: 'size' }).filter((n) => n.type === 'file').map((n) => n.name)).toEqual(['a2.txt', 'b.txt', 'a10.txt']);
		expect(sortNodes(nodes, { key: 'date', dir: 'desc' }).filter((n) => n.type === 'file').map((n) => n.name)).toEqual(['b.txt', 'a2.txt', 'a10.txt']);
		expect(sortNodes([f('b.png'), f('a.txt')], { key: 'type' }).map((n) => n.name)).toEqual(['b.png', 'a.txt']);
		expect(nodes).toEqual(copy);
	});
	it('filters by name, case-insensitively', () => {
		expect(filterByName(nodes, 'A').length).toBe(3);
		expect(filterByName(nodes, '  zed ').map((n) => n.name)).toEqual(['Zed']);
		expect(filterByName(nodes, '')).toBe(nodes);
		expect(filterByName(nodes, 'nope')).toEqual([]);
	});
});

describe('files: navigation', () => {
	it('builds breadcrumbs', () => {
		expect(buildCrumbs('@home')).toEqual([{ name: 'Home', path: '@home' }]);
		expect(buildCrumbs('/')).toEqual([{ name: 'This PC', path: '/' }]);
		expect(buildCrumbs('/Documents/a b')).toEqual([
			{ name: 'This PC', path: '/' }, { name: 'Documents', path: '/Documents' }, { name: 'a b', path: '/Documents/a b' },
		]);
		expect(buildCrumbs('/Trash')[1]).toEqual({ name: 'Recycle Bin', path: '/Trash' });
	});
	it('parses typed addresses', () => {
		expect(parseAddress('')).toBe('/');
		expect(parseAddress('This PC')).toBe('/');
		expect(parseAddress('home')).toBe('@home');
		expect(parseAddress('Recycle Bin')).toBe('/Trash');
		expect(parseAddress('This PC\\Documents\\x')).toBe('/Documents/x');
		expect(parseAddress('/Pictures/../Music/')).toBe('/Music');
		expect(parseAddress('Documents')).toBe('/Documents');
	});
	it('moves the cursor through list and grid layouts', () => {
		expect(moveIndex(-1, 'ArrowDown', 5)).toBe(0);
		expect(moveIndex(-1, 'ArrowUp', 5)).toBe(4);
		expect(moveIndex(0, 'ArrowUp', 5)).toBe(0);
		expect(moveIndex(4, 'ArrowDown', 5)).toBe(4);
		expect(moveIndex(2, 'ArrowLeft', 5)).toBe(2);
		expect(moveIndex(2, 'ArrowLeft', 5, 3)).toBe(1);
		expect(moveIndex(1, 'ArrowDown', 9, 3)).toBe(4);
		expect(moveIndex(8, 'ArrowDown', 9, 3)).toBe(8);
		expect(moveIndex(3, 'Home', 9)).toBe(0);
		expect(moveIndex(3, 'End', 9)).toBe(8);
		expect(moveIndex(0, 'ArrowDown', 0)).toBe(-1);
	});
});

describe('files: selection', () => {
	const order = ['a', 'b', 'c', 'd', 'e'];
	it('selects ranges in either direction', () => {
		expect(rangeSelect(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
		expect(rangeSelect(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
		expect(rangeSelect(order, null, 'c')).toEqual(['c']);
		expect(rangeSelect(order, 'a', 'zzz')).toEqual([]);
	});
	it('only lets legal moves through', () => {
		expect(movablePaths(['/Documents/a', '/Pictures/b'], '/Documents')).toEqual(['/Pictures/b']);
		expect(movablePaths(['/Documents/dir'], '/Documents/dir')).toEqual([]);
		expect(movablePaths(['/Documents/dir'], '/Documents/dir/inner')).toEqual([]);
		expect(movablePaths(['/Documents/dir2'], '/Documents/dir')).toEqual(['/Documents/dir2']);
	});
	it('summarises and words the status bar', () => {
		const s = selectionSummary([f('a', { size: 1024 }), f('b', { size: 1024 }), d('x')]);
		expect(s).toEqual({ count: 3, bytes: 2048, dirs: 1 });
		expect(statusText(1, { count: 0, bytes: 0, dirs: 0 })).toBe('1 item');
		expect(statusText(12, { count: 0, bytes: 0, dirs: 0 })).toBe('12 items');
		expect(statusText(12, s)).toBe('12 items   3 selected   2 KB');
		expect(statusText(2, { count: 1, bytes: 0, dirs: 1 })).toBe('2 items   1 selected');
	});
});

describe('notepad: find and replace', () => {
	it('finds matches with and without case', () => {
		expect(findMatches('Abc abc ABC', 'abc')).toEqual([0, 4, 8]);
		expect(findMatches('Abc abc ABC', 'abc', true)).toEqual([4]);
		expect(findMatches('aaaa', 'aa')).toEqual([0, 2]);
		expect(findMatches('text', '')).toEqual([]);
		expect(findMatches('', 'x')).toEqual([]);
	});
	it('replaces all matches', () => {
		expect(replaceAll('one two one', 'one', '1')).toEqual({ text: '1 two 1', count: 2 });
		expect(replaceAll('One one', 'one', 'x', true)).toEqual({ text: 'One x', count: 1 });
		expect(replaceAll('abc', 'z', 'y')).toEqual({ text: 'abc', count: 0 });
		expect(replaceAll('a.b.c', '.', '')).toEqual({ text: 'abc', count: 2 });
	});
	it('wraps to the next match', () => {
		const m = [3, 10, 20];
		expect(nextMatchIndex(m, 0)).toBe(0);
		expect(nextMatchIndex(m, 10)).toBe(1);
		expect(nextMatchIndex(m, 21)).toBe(0);
		expect(nextMatchIndex(m, 10, true)).toBe(0);
		expect(nextMatchIndex(m, 3, true)).toBe(2);
		expect(nextMatchIndex([], 5)).toBe(-1);
	});
});

describe('notepad: positions and names', () => {
	it('computes line and column', () => {
		expect(lineCol('', 0)).toEqual({ line: 1, col: 1 });
		expect(lineCol('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
		expect(lineCol('ab\n', 3)).toEqual({ line: 2, col: 1 });
	});
	it('finds line starts and counts lines', () => {
		expect(offsetOfLine('ab\ncd\nef', 1)).toBe(0);
		expect(offsetOfLine('ab\ncd\nef', 3)).toBe(6);
		expect(offsetOfLine('ab\ncd', 99)).toBe(3);
		expect(countLines('a\nb\nc')).toBe(3);
		expect(countLines('')).toBe(1);
	});
	it('clamps zoom and builds titles and names', () => {
		expect(clampSize(2)).toBe(MIN_SIZE);
		expect(clampSize(900)).toBe(MAX_SIZE);
		expect(zoomPercent(14)).toBe(100);
		expect(zoomPercent(28)).toBe(200);
		expect(titleFor('a.txt', true)).toBe('*a.txt - Notepad');
		expect(titleFor('a.txt', false)).toBe('a.txt - Notepad');
		expect(fileNameFrom('  notes ')).toBe('notes.txt');
		expect(fileNameFrom('a.md')).toBe('a.md');
		expect(fileNameFrom('   ')).toBe('');
	});
	it('rejects malformed drafts', () => {
		const good = { id: 'd1', name: 'a.txt', text: 'hi', path: '/Documents/a.txt', extra: 1 };
		expect(parseDrafts(JSON.stringify([good, { id: 3 }, null, { id: 'x', name: 'n', text: 't' }]))).toEqual([
			{ id: 'd1', name: 'a.txt', text: 'hi', path: '/Documents/a.txt' },
			{ id: 'x', name: 'n', text: 't', path: null },
		]);
		expect(parseDrafts('not json')).toEqual([]);
		expect(parseDrafts('{"a":1}')).toEqual([]);
		expect(parseDrafts(null)).toEqual([]);
	});
});

describe('photos', () => {
	it('keeps only images and orders them', () => {
		const nodes = [f('a.png', { mtime: 5 }), f('b.txt'), d('dir.png'), f('c.JPG', { mtime: 9 }), f('d.webp', { mtime: 5 })];
		expect(newestFirst(nodes).map((n) => n.name)).toEqual(['c.JPG', 'a.png', 'd.webp']);
		expect(byName([f('img10.png'), f('img2.png'), f('x.md')]).map((n) => n.name)).toEqual(['img2.png', 'img10.png']);
		expect(isImageName('x.svg')).toBe(true);
		expect(isImageName('x.glb')).toBe(false);
	});
	it('steps with wraparound', () => {
		expect(stepIndex(0, -1, 4)).toBe(3);
		expect(stepIndex(3, 1, 4)).toBe(0);
		expect(stepIndex(1, 1, 4)).toBe(2);
		expect(stepIndex(0, 1, 0)).toBe(-1);
		expect(positionLabel(2, 12)).toBe('3 of 12');
		expect(positionLabel(-1, 12)).toBe('');
	});
	it('fits pictures and handles rotation', () => {
		expect(rotatedSize(400, 200, 90)).toEqual({ w: 200, h: 400 });
		expect(rotatedSize(400, 200, 180)).toEqual({ w: 400, h: 200 });
		expect(rotatedSize(400, 200, -90)).toEqual({ w: 200, h: 400 });
		expect(fitScale(2000, 1000, 1000, 1000)).toBe(0.5);
		expect(fitScale(100, 100, 1000, 1000)).toBe(1);
		expect(fitScale(2000, 1000, 1000, 1000, 90)).toBe(0.5);
		expect(fitScale(1000, 2000, 1000, 500, 90)).toBe(0.5);
		expect(fitScale(0, 0, 100, 100)).toBe(1);
	});
	it('clamps pan and zoom, and zooms about the cursor', () => {
		expect(clampPan(9999, 400, 600)).toBe(452);
		expect(clampPan(-9999, 400, 600)).toBe(-452);
		expect(clampPan(10, 400, 600)).toBe(10);
		expect(clampZoom(100)).toBe(16);
		expect(clampZoom(0)).toBe(0.05);
		const z = zoomAt({ s: 1, x: 0, y: 0 }, 2, 100, 50);
		expect(z).toEqual({ s: 2, x: -100, y: -50 });
		expect(zoomAt({ s: 16, x: 3, y: 4 }, 2, 10, 10)).toEqual({ s: 16, x: 3, y: 4 });
	});
});
