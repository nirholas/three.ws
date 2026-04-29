const DEFAULT_RPC = 'https://rpc.solanatracker.io/public';

export async function pumpfun_build_payment(args, ctx) {
	const { PumpAgent } = await import('@pump-fun/agent-payments-sdk');
	const agent = new PumpAgent(args.agentMint);
	const instructions = await agent.buildAcceptPaymentInstructions({
		payer: args.payer,
		amount: args.amount,
		currencyMint: args.currencyMint,
		invoiceId: args.invoiceId,
		startTime: args.startTime,
		endTime: args.endTime,
	});
	return { instructions: instructions.map((ix) => ix.toJSON?.() ?? ix) };
}

export async function pumpfun_verify_payment(args, ctx) {
	const { PumpAgent } = await import('@pump-fun/agent-payments-sdk');
	const { Connection } = await import('@solana/web3.js');
	const agent = new PumpAgent(args.agentMint);
	const connection = new Connection(args.rpcUrl || DEFAULT_RPC);
	const paid = await agent.validateInvoicePayment({
		connection,
		payer: args.payer,
		invoiceId: args.invoiceId,
	});
	return { paid };
}
