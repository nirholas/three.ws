/**
 * Minimal ERC-8004 helpers for the character studio.
 * Handles wallet connection, IPFS pinning, and on-chain registration.
 */

import { BrowserProvider, Contract } from 'ethers';

const IDENTITY_REGISTRY_ABI = [
  'function register(string agentURI) external returns (uint256 agentId)',
  'function setAgentURI(uint256 agentId, string newURI) external',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

const TESTNET_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const MAINNET_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

const TESTNET_CHAIN_IDS = new Set([97, 11155111, 84532, 421614, 11155420, 80002, 43113]);

const SUPPORTED_CHAINS = {
  1: { name: 'Ethereum', registry: MAINNET_REGISTRY },
  10: { name: 'Optimism', registry: MAINNET_REGISTRY },
  137: { name: 'Polygon', registry: MAINNET_REGISTRY },
  8453: { name: 'Base', registry: MAINNET_REGISTRY },
  42161: { name: 'Arbitrum One', registry: MAINNET_REGISTRY },
  43114: { name: 'Avalanche', registry: MAINNET_REGISTRY },
  11155111: { name: 'Ethereum Sepolia', registry: TESTNET_REGISTRY },
  84532: { name: 'Base Sepolia', registry: TESTNET_REGISTRY },
  421614: { name: 'Arbitrum Sepolia', registry: TESTNET_REGISTRY },
  80002: { name: 'Polygon Amoy', registry: TESTNET_REGISTRY },
};

export function getSupportedChains() {
  return SUPPORTED_CHAINS;
}

export function getRegistryAddress(chainId) {
  return SUPPORTED_CHAINS[chainId]?.registry ?? null;
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export async function connectWallet() {
  if (!window.ethereum) throw new Error('No wallet detected. Install MetaMask to continue.');
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  return { provider, signer, address, chainId };
}

// ---------------------------------------------------------------------------
// IPFS pinning via Pinata
// ---------------------------------------------------------------------------

async function pinJSON(obj, pinataJWT) {
  if (!pinataJWT) throw new Error('A Pinata JWT is required to pin files to IPFS.');
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const form = new FormData();
  form.append('file', blob, 'manifest.json');
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pinataJWT}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Pinata upload failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return `ipfs://${data.IpfsHash}`;
}

// ---------------------------------------------------------------------------
// Registration JSON builder
// ---------------------------------------------------------------------------

function buildRegistrationJSON({ name, manifestURL, agentId, chainId, registryAddr }) {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: name || 'Character',
    description: `VRM character studio manifest`,
    active: true,
    services: [
      {
        name: 'vrm-manifest',
        endpoint: manifestURL,
        version: '1.0',
      },
    ],
    registrations: [
      {
        agentId,
        agentRegistry: `eip155:${chainId}:${registryAddr}`,
      },
    ],
    supportedTrust: ['reputation'],
  };
}

// ---------------------------------------------------------------------------
// Full registration flow
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.name          Display name for the on-chain token
 * @param {string} opts.manifestURL   URL of the VRM character manifest JSON
 * @param {string} opts.pinataJWT     Pinata API JWT for IPFS pinning
 * @param {(msg: string) => void} opts.onStatus  Progress callback
 * @returns {Promise<{ agentId: number, txHash: string, chainId: number, registrationURL: string }>}
 */
export async function registerCharacterOnChain({ name, manifestURL, pinataJWT, onStatus }) {
  const log = onStatus || (() => {});

  log('Connecting wallet…');
  const { signer, chainId } = await connectWallet();

  const registryAddr = getRegistryAddress(chainId);
  if (!registryAddr) {
    throw new Error(
      `Chain ${chainId} is not supported. Switch to one of: ${Object.values(SUPPORTED_CHAINS)
        .map((c) => c.name)
        .join(', ')}.`
    );
  }

  const registry = new Contract(registryAddr, IDENTITY_REGISTRY_ABI, signer);

  log('Registering on-chain…');
  const tx = await registry['register(string)'](manifestURL);
  log(`Transaction submitted: ${tx.hash}`);
  const receipt = await tx.wait();

  let agentId = null;
  for (const log_ of receipt.logs) {
    try {
      const parsed = registry.interface.parseLog(log_);
      if (parsed?.name === 'Registered') {
        agentId = Number(parsed.args.agentId);
        break;
      }
    } catch { /* not our event */ }
  }
  if (agentId == null) throw new Error('Registered event not found in receipt.');
  log(`Minted agentId = ${agentId}`);

  log('Pinning registration metadata to IPFS…');
  const registrationJSON = buildRegistrationJSON({ name, manifestURL, agentId, chainId, registryAddr });
  const registrationURL = await pinJSON(registrationJSON, pinataJWT);
  log(`Pinned: ${registrationURL}`);

  log('Updating agentURI on-chain…');
  const updateTx = await registry.setAgentURI(agentId, registrationURL);
  await updateTx.wait();
  log('Done.');

  return { agentId, txHash: tx.hash, chainId, registrationURL };
}
