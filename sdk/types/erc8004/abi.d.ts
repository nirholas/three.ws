export interface RegistryAddresses {
	identityRegistry?: string;
	reputationRegistry?: string;
	validationRegistry?: string;
}

export declare const IDENTITY_REGISTRY_ABI: readonly string[];
export declare const REPUTATION_REGISTRY_ABI: readonly string[];
export declare const VALIDATION_REGISTRY_ABI: readonly string[];
export declare const REGISTRY_DEPLOYMENTS: Record<number, RegistryAddresses>;

export declare function agentRegistryId(chainId: number, registryAddress: string): string;
