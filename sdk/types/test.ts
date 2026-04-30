// Consumer smoke-test — verifies declarations compile without errors.
// Not a runtime test; never import this from production code.

import {
	AgentKit,
	AgentPanel,
	agentRegistration,
	agentCard,
	aiPlugin,
	PermissionsClient,
	PermissionError,
	detectSolanaProvider,
	signInWithSolana,
	registerSolanaAgent,
	startSolanaCheckout,
	confirmSolanaPayment,
	attestFeedback,
	attestValidation,
	createTask,
	acceptTask,
	attestRevoke,
	attestDispute,
	listAttestations,
	fetchAttestations,
	fetchReputation,
	connectWallet,
	getSigner,
	pinToIPFS,
	buildRegistrationJSON,
	getIdentityRegistry,
	registerAgent,
	IDENTITY_REGISTRY_ABI,
	REPUTATION_REGISTRY_ABI,
	VALIDATION_REGISTRY_ABI,
	REGISTRY_DEPLOYMENTS,
	agentRegistryId,
} from '../src/index.js';

// AgentKit
const kit = new AgentKit({ name: 'Test Agent', endpoint: 'https://example.com' });
kit.mount(document.body).open().close();
kit.addMessage('user', 'hello');
kit.dispose();
const r: Promise<{ agentId: number; registrationCID: string; txHash: string }> = kit.register({ ipfsToken: 'tok' });
const m = kit.manifests({ openapiUrl: 'https://example.com/openapi.yaml' });
const _a: object = m.agentRegistration;
const _b: object = m.agentCard;
const _c: object = m.aiPlugin;

// AgentPanel
const panel = new AgentPanel({ title: 'Test', voice: false });
panel.mount(document.body);
panel.open();
panel.close();
panel.addMessage('agent', 'hi');
panel.dispose();

// manifests
const _reg = agentRegistration({ name: 'n', description: 'd', endpoint: 'https://x.com' });
const _card = agentCard({ name: 'n', description: 'd', url: 'https://x.com' });
const _plugin = aiPlugin({ name: 'n', description: 'd', openapiUrl: 'https://x.com/openapi.yaml' });

// permissions
const client = new PermissionsClient({ baseUrl: 'https://three.ws/' });
const _list: Promise<unknown[]> = client.listDelegations({ agentId: 'abc' });
const _meta = client.getMetadata('abc');
const _verify = client.verify('0xabc', 1);
const _err = new PermissionError('delegation_expired', 'expired');

// solana
const _provider = detectSolanaProvider('phantom');
const _siws = signInWithSolana({ chainId: 'mainnet' });
const _sol = registerSolanaAgent({ name: 'Agent' });
const _checkout = startSolanaCheckout({ plan: 'pro' });
const _confirm = confirmSolanaPayment({ intentId: 'id', txSignature: 'sig' });

// solana attestations
const _feedback = attestFeedback({ agentAsset: 'pub', score: 5 });
const _validation = attestValidation({ agentAsset: 'pub', taskHash: 'hash', passed: true });
const _task = createTask({ agentAsset: 'pub', taskId: 'tid', scopeHash: 'sh' });
const _accept = acceptTask({ agentAsset: 'pub', taskId: 'tid' });
const _revoke = attestRevoke({ agentAsset: 'pub', targetSignature: 'sig' });
const _dispute = attestDispute({ agentAsset: 'pub', targetSignature: 'sig' });
const _atts = listAttestations({ agentAsset: 'pub', kind: 'all' });
const _fatts = fetchAttestations({ agentAsset: 'pub' });
const _rep = fetchReputation({ agentAsset: 'pub' });

// erc8004
const _abis: readonly string[] = IDENTITY_REGISTRY_ABI;
const _rabis: readonly string[] = REPUTATION_REGISTRY_ABI;
const _vabis: readonly string[] = VALIDATION_REGISTRY_ABI;
const _deployments = REGISTRY_DEPLOYMENTS[1];
const _regId: string = agentRegistryId(1, '0xabc');
const _signer = getSigner();
const _wallet = connectWallet();
const _ipfs = pinToIPFS(new Blob(['test']), 'token');
const _regJson = buildRegistrationJSON({
	name: 'n', description: 'd', imageCID: null,
	agentId: 1, chainId: 1, registryAddr: '0xabc',
});
const _registry = getIdentityRegistry(1, null);
const _onchain = registerAgent({ name: 'n', description: 'd', endpoint: 'https://x.com' });
