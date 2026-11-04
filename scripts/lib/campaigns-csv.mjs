// Reads marketing/growth/campaigns.csv (quoted CSV, first column campaign_id).
import { readFileSync } from 'node:fs';

const CSV = new URL('../../marketing/growth/campaigns.csv', import.meta.url);

function parseLine(line) {
	const out = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quoted) {
			if (ch === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cur += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out;
}

/** [{campaign_id, ...columns}] for every row of campaigns.csv. */
export function readCampaigns() {
	const [head, ...rows] = readFileSync(CSV, 'utf8').split('\n').filter(Boolean);
	const cols = parseLine(head);
	return rows.map((r) => Object.fromEntries(parseLine(r).map((v, i) => [cols[i], v])));
}
