import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { z } from 'zod';

/**
 * Minimal structural interface compatible with solana-agent-kit's SolanaAgentKit.
 * Uses structural typing so consumers don't need to import SolanaAgentKit directly.
 */
interface SolanaAgentKitLike {
    connection: Connection;
    wallet: Keypair;
    wallet_address: PublicKey;
}
type ActionHandler = (agent: SolanaAgentKitLike, input: Record<string, any>) => Promise<Record<string, any>>;
interface ActionExample {
    input: Record<string, string>;
    output: Record<string, string>;
    explanation: string;
}
interface Action {
    name: string;
    similes: string[];
    description: string;
    examples: ActionExample[][];
    schema: z.ZodType<any>;
    handler: ActionHandler;
}
interface Plugin {
    name: string;
    methods: Record<string, Function>;
    actions: Action[];
}

declare const createAgentPaymentsAction: Action;
declare const buildPaymentInstructionsAction: Action;
declare const getBalancesAction: Action;
declare const validateInvoiceAction: Action;
declare const distributePaymentsAction: Action;
declare const withdrawAction: Action;
declare const getConfigAction: Action;
declare const getPaymentStatsAction: Action;
declare const updateBuybackBpsAction: Action;
declare const allActions: Action[];

declare const PumpAgentPaymentsPlugin: Plugin;

export { type Action, type ActionExample, type ActionHandler, type Plugin, PumpAgentPaymentsPlugin, type SolanaAgentKitLike, allActions, buildPaymentInstructionsAction, createAgentPaymentsAction, distributePaymentsAction, getBalancesAction, getConfigAction, getPaymentStatsAction, updateBuybackBpsAction, validateInvoiceAction, withdrawAction };
