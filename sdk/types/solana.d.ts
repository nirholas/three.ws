export declare function detectSolanaProvider(preferred?: string | null): unknown | null;

export interface SignInWithSolanaOptions {
	preferred?: string | null;
	nonceUrl?: string;
	verifyUrl?: string;
	chainId?: string;
}
export declare function signInWithSolana(opts?: SignInWithSolanaOptions): Promise<{ user: object; wallet: object }>;

export interface RegisterSolanaAgentOptions {
	name: string;
	description?: string;
	avatarId?: string;
	network?: 'mainnet' | 'devnet';
	preferred?: string | null;
	onStatus?: (msg: string) => void;
}
export declare function registerSolanaAgent(opts?: RegisterSolanaAgentOptions): Promise<{
	agent: object;
	sol_mint_address: string;
	tx_signature: string;
}>;

export interface StartSolanaCheckoutOptions {
	plan: 'pro' | 'team' | 'enterprise';
	network?: 'mainnet' | 'devnet';
}
export declare function startSolanaCheckout(opts?: StartSolanaCheckoutOptions): Promise<{
	solana_pay_url: string;
	intent_id: string;
	amount_usdc: number;
	nonce: string;
}>;

export interface ConfirmSolanaPaymentOptions {
	intentId: string;
	txSignature: string;
	network?: 'mainnet' | 'devnet';
}
export declare function confirmSolanaPayment(opts?: ConfirmSolanaPaymentOptions): Promise<{
	ok: boolean;
	plan: string;
	active_until: string;
}>;
