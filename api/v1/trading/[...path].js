// /api/v1/trading/*: Solana trading tools over REST (quotes across aggregators,
// guarded swaps, market and ecosystem signals, arbitrage with its worst case).
// Route table: api/_lib/trading-tools/routes.js. Guide: docs/trading-tools.md.

import { defineRouter } from '../../_lib/agents-v1/http.js';
import { tradingRoutes } from '../../_lib/trading-tools/routes.js';

export default defineRouter({ base: '/api/v1', routes: tradingRoutes });
