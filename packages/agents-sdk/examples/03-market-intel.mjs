// Read-only market intelligence: macro readings and the top movers.
import { ThreeAgents } from '../dist/index.js';

const client = new ThreeAgents({ apiKey: process.env.THREE_WS_API_KEY, baseUrl: process.env.THREE_WS_BASE_URL });
const macro = await client.getMacro({ window: '1h' });
console.log('macro window', macro.window, 'as of', macro.as_of);
const movers = await client.getTopMovers({ window: '1h', limit: 3 });
for (const [board, list] of Object.entries(movers.movers)) {
	console.log(board, list.items.map((i) => i.symbol ?? i.mint).join(', ') || '(none)');
}
