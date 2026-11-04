// Read-only: credit balance, plan usage and linked integrations.
import { ThreeAgents } from '../dist/index.js';

const client = new ThreeAgents({ apiKey: process.env.THREE_WS_API_KEY, baseUrl: process.env.THREE_WS_BASE_URL });
const budget = await client.getBudget();
console.log('balance USD', budget.balanceUsd);
const usage = await client.getUsage();
console.log('plan', usage.plan.plan, 'avatars', usage.counts.avatars);
const { integrations } = await client.listIntegrations();
console.log('integrations', integrations.map((i) => `${i.provider}:${i.connected}`).join(' '));
