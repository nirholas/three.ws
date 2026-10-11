#!/usr/bin/env node
// node contact-sheet.mjs <stillsDir> <outFile> [cols] [thumbWidth]
// Tiles every PNG in a directory, labelled with its timestamp, into one image.
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const [dir, out, colsArg = '4', widthArg = '640'] = process.argv.slice(2);
const cols = Number(colsArg);
const tw = Number(widthArg);
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const meta = await sharp(path.join(dir, files[0])).metadata();
const th = Math.round((tw * meta.height) / meta.width);
const rows = Math.ceil(files.length / cols);
const label = (name) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="34"><rect width="100%" height="100%" fill="#000" opacity=".7"/><text x="10" y="24" font-family="monospace" font-size="20" fill="#fff">${name.replace(/\.png$/, '').replace(/^(\w+)-/, '$1  t=')}s</text></svg>`);
const tiles = await Promise.all(files.map(async (f, i) => ({
	input: await sharp(path.join(dir, f)).resize(tw, th).composite([{ input: label(f), top: 0, left: 0 }]).png().toBuffer(),
	left: (i % cols) * (tw + 6),
	top: Math.floor(i / cols) * (th + 6),
})));
await sharp({ create: { width: cols * (tw + 6), height: rows * (th + 6), channels: 3, background: '#222' } }).composite(tiles).png().toFile(out);
console.log('contact sheet', out, `${files.length} frames`);
