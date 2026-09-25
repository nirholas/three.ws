// Proof of life for the `eventsource` adoption in multiplayer/: a Node process
// (the Colyseus server has no global EventSource) subscribes to the live sniper
// SSE feed a trade room would relay, and prints every named event it receives.
//   node scripts/proof-eventsource-sniper-stream.mjs [seconds] [base-url]
import { createRequire } from 'node:module';
const { EventSource } = createRequire(new URL('../multiplayer/package.json', import.meta.url))('eventsource');

const seconds = Number(process.argv[2] || 40);
const base = (process.argv[3] || 'https://three.ws').replace(/\/$/, '');
const counts = {};
const es = new EventSource(`${base}/api/sniper/stream?network=mainnet`);
for (const name of ['open', 'buy', 'sell', 'update', 'ping', 'close', 'error']) {
	es.addEventListener(name, (ev) => {
		counts[name] = (counts[name] || 0) + 1;
		const data = ev.data ? JSON.parse(ev.data) : null;
		const brief = data && data.mint ? `${data.agent_name} ${data.symbol || data.mint.slice(0, 6)} ${data.status}` : JSON.stringify(data);
		console.log(new Date().toISOString(), name, brief);
	});
}
es.onerror = (err) => console.log('transport error', err?.message || err?.code || '', 'readyState', es.readyState);
setTimeout(() => { es.close(); console.log('counts', JSON.stringify(counts)); process.exit(counts.open ? 0 : 1); }, seconds * 1000);
