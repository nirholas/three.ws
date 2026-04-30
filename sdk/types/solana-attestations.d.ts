export interface AttestationResult {
	signature: string;
	memo: object;
}

export interface AttestFeedbackOptions {
	agentAsset: string;
	score: number;
	taskId?: string;
	uri?: string;
	network?: 'mainnet' | 'devnet';
	preferred?: string | null;
}
export declare function attestFeedback(opts?: AttestFeedbackOptions): Promise<AttestationResult>;

export interface AttestValidationOptions {
	agentAsset: string;
	taskHash: string;
	passed: boolean;
	uri?: string;
	network?: 'mainnet' | 'devnet';
	preferred?: string | null;
}
export declare function attestValidation(opts?: AttestValidationOptions): Promise<AttestationResult>;

export interface CreateTaskOptions {
	agentAsset: string;
	taskId: string;
	scopeHash: string;
	uri?: string;
	network?: 'mainnet' | 'devnet';
	preferred?: string | null;
}
export declare function createTask(opts?: CreateTaskOptions): Promise<AttestationResult>;

export interface AcceptTaskOptions {
	agentAsset: string;
	taskId: string;
	network?: 'mainnet' | 'devnet';
	preferred?: string | null;
}
export declare function acceptTask(opts?: AcceptTaskOptions): Promise<AttestationResult>;

export interface AttestRevokeOptions {
	agentAsset: string;
	targetSignature: string;
	reason?: string;
	network?: 'mainnet' | 'devnet';
	preferred?: string | null;
}
export declare function attestRevoke(opts?: AttestRevokeOptions): Promise<AttestationResult>;

export interface AttestDisputeOptions {
	agentAsset: string;
	targetSignature: string;
	reason?: string;
	uri?: string;
	network?: 'mainnet' | 'devnet';
	preferred?: string | null;
}
export declare function attestDispute(opts?: AttestDisputeOptions): Promise<AttestationResult>;

export interface ListAttestationsOptions {
	agentAsset: string;
	kind?: 'feedback' | 'validation' | 'all';
	limit?: number;
	network?: 'mainnet' | 'devnet';
}
export declare function listAttestations(opts?: ListAttestationsOptions): Promise<
	Array<{ signature: string; slot: number; attester: string; memo: object }>
>;

export interface FetchAttestationsOptions {
	agentAsset: string;
	kind?: string;
	network?: 'mainnet' | 'devnet';
	apiOrigin?: string;
}
export declare function fetchAttestations(opts?: FetchAttestationsOptions): Promise<unknown>;

export interface FetchReputationOptions {
	agentAsset: string;
	network?: 'mainnet' | 'devnet';
	apiOrigin?: string;
}
export declare function fetchReputation(opts?: FetchReputationOptions): Promise<unknown>;
