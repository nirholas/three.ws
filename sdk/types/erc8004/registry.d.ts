export interface WalletConnection {
	provider: unknown;
	signer: unknown;
	address: string;
	chainId: number;
}

export declare function connectWallet(): Promise<WalletConnection>;
export declare function getSigner(): unknown | null;

export declare function pinToIPFS(blob: Blob | File, apiToken?: string): Promise<string>;

export interface BuildRegistrationJSONOptions {
	name: string;
	description: string;
	imageCID: string | null;
	agentId: number;
	chainId: number;
	registryAddr: string;
	services?: unknown[];
}
export declare function buildRegistrationJSON(opts: BuildRegistrationJSONOptions): object;

export declare function getIdentityRegistry(chainId: number, signer: unknown): unknown;

export interface RegisterAgentOptions {
	name: string;
	description: string;
	endpoint: string;
	imageFile?: File;
	services?: unknown[];
	apiToken?: string;
	onStatus?: (message: string) => void;
}
export declare function registerAgent(opts: RegisterAgentOptions): Promise<{
	agentId: number;
	registrationCID: string;
	txHash: string;
}>;
