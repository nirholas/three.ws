// Creates an agent, reads it back, starts and stops it, then deletes it.
import { ThreeAgents } from '../dist/index.js';

const client = new ThreeAgents({ apiKey: process.env.THREE_WS_API_KEY, baseUrl: process.env.THREE_WS_BASE_URL });
const agent = await client.createAgent({ name: `sdk-example-${Date.now()}` });
try {
	console.log('created', agent.id);
	console.log('read back', (await client.getAgent(agent.id)).name);
	console.log('started', (await client.startAgent(agent.id)).status);
	console.log('stopped', (await client.stopAgent(agent.id)).status);
} finally {
	await client.deleteAgent(agent.id);
	console.log('deleted', agent.id);
}
