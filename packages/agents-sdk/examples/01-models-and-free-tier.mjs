// Read-only: the model catalog and your free-tier allowance.
import { ThreeAgents } from '../dist/index.js';

const client = new ThreeAgents({ apiKey: process.env.THREE_WS_API_KEY, baseUrl: process.env.THREE_WS_BASE_URL });
const models = await client.getModels();
const free = await client.getFreeTierStatus();
console.log('models:', Array.isArray(models?.models) ? models.models.length : Object.keys(models).length);
console.log('free tier remaining:', free.remaining, 'of', free.limit);
