export declare class PermissionError extends Error {
	code: string;
	name: 'PermissionError';
	constructor(code: string, message: string);
}

export interface DelegationPublic {
	id: string;
	delegationHash: string;
	agentId: string;
	delegator: string;
	delegate: string;
	status: string;
	chainId: number;
	[key: string]: unknown;
}

export interface ScopePreset {
	token: string;
	maxAmount: string;
	period: string;
	targets: string[];
	expiryDays: number;
}

export interface PermissionsClientOptions {
	baseUrl?: string;
	bearer?: string;
}

export declare class PermissionsClient {
	constructor(opts?: PermissionsClientOptions);
	listDelegations(params?: {
		agentId?: string;
		delegator?: string;
		status?: string;
	}): Promise<DelegationPublic[]>;
	getMetadata(agentId: string): Promise<{ spec: string; delegations: DelegationPublic[] }>;
	grant(params: {
		agentId: string;
		chainId: number;
		preset: ScopePreset;
		delegate: string;
		signer: unknown;
	}): Promise<{ id: string; delegationHash: string }>;
	redeem(params: {
		id: string;
		calls: Array<{ to: string; value?: string; data: string }>;
	}): Promise<{ txHash: string }>;
	revoke(params: {
		id: string;
		delegationHash: string;
		signer: unknown;
	}): Promise<{ status: 'revoked'; txHash: string }>;
	verify(hash: string, chainId: number): Promise<{ valid: boolean; reason?: string }>;
}
