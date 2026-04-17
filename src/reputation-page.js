/**
 * Reputation page entry point for Vite bundling.
 * Exports the main reputation page logic.
 */

import { getReputation, getRecentReviews, submitReputation } from './erc8004/reputation.js';
import { JsonRpcProvider, BrowserProvider } from 'ethers';
import { REGISTRY_DEPLOYMENTS } from './erc8004/abi.js';

export { getReputation, getRecentReviews, submitReputation, JsonRpcProvider, BrowserProvider, REGISTRY_DEPLOYMENTS };
