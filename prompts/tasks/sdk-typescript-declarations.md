# Task: Add TypeScript declaration files to @nirholas/agent-kit SDK

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

The SDK is at `sdk/` and published as `@nirholas/agent-kit`. It is pure JavaScript (JSDoc-only, no TypeScript source). Consumers who use TypeScript or have `"checkJs": true` get no autocomplete or type safety.

**Current SDK structure:**
```
sdk/
  src/
    index.js          — main export, AgentKit class
    panel.js          — AgentPanel UI component
    manifests.js      — generate .well-known JSON files
    permissions.js    — PermissionsClient (ERC-7710 delegations)
    solana.js         — signInWithSolana(), registerSolanaAgent(), Solana Pay
    solana-attestations.js — attestFeedback(), attestValidation()
    erc8004/
      abi.js          — REGISTRY_DEPLOYMENTS, contract ABIs
      registry.js     — connectWallet(), registerAgent(), pinToIPFS(), buildRegistrationJSON()
  package.json
```

The SDK's `package.json` likely has no `types` field. There are no `.d.ts` files.

**The goal:** Write hand-authored `.d.ts` declaration files for the entire public API surface of the SDK. These should be accurate enough for autocomplete and type-checking without being so strict they generate spurious errors in downstream TS projects.

---

## Files to create

Create `sdk/types/` directory with one `.d.ts` per source module, plus an `index.d.ts` root:

```
sdk/types/
  index.d.ts
  panel.d.ts
  manifests.d.ts
  permissions.d.ts
  solana.d.ts
  solana-attestations.d.ts
  erc8004/
    abi.d.ts
    registry.d.ts
```

---

## Declarations to write

Read each source file carefully before writing its declaration. Here is the expected shape — verify against actual source:

### `sdk/types/index.d.ts`

```ts
export { AgentKit } from './AgentKit';
export type { AgentKitOptions } from './AgentKit';

export declare class AgentKit {
  constructor(options: AgentKitOptions);
  connect(): Promise<void>;
  disconnect(): void;
  readonly panel: import('./panel').AgentPanel;
}

export interface AgentKitOptions {
  agentId: string;
  serverUrl?: string;
  /** EVM chain ID to use for ERC-8004 registration */
  chainId?: number;
  /** Element to mount the chat panel into */
  container?: HTMLElement | string;
}
```

### `sdk/types/panel.d.ts`

```ts
export declare class AgentPanel {
  constructor(opts: AgentPanelOptions);
  mount(container: HTMLElement): void;
  unmount(): void;
  open(): void;
  close(): void;
  toggle(): void;
  on(event: AgentPanelEvent, handler: (data: unknown) => void): void;
  off(event: AgentPanelEvent, handler: (data: unknown) => void): void;
}

export interface AgentPanelOptions {
  agentId: string;
  serverUrl?: string;
  theme?: 'light' | 'dark' | 'auto';
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

export type AgentPanelEvent = 'message' | 'open' | 'close' | 'error';
```

### `sdk/types/manifests.d.ts`

```ts
export interface AgentManifest {
  name: string;
  description?: string;
  modelUri?: string;
  skills?: string[];
  author?: string;
  chainId?: number;
  agentId?: number;
}

export declare function generateAgentRegistration(manifest: AgentManifest): AgentRegistrationJSON;
export declare function generateAgentCard(manifest: AgentManifest): AgentCardJSON;
export declare function generateAiPlugin(manifest: AgentManifest): AiPluginJSON;

export interface AgentRegistrationJSON { [key: string]: unknown }
export interface AgentCardJSON { [key: string]: unknown }
export interface AiPluginJSON { [key: string]: unknown }
```

### `sdk/types/permissions.d.ts`

```ts
export declare class PermissionsClient {
  constructor(opts: PermissionsClientOptions);
  requestPermission(params: PermissionRequest): Promise<PermissionGrant>;
  revokePermission(grantId: string): Promise<void>;
  listPermissions(): Promise<PermissionGrant[]>;
}

export interface PermissionsClientOptions {
  chainId: number;
  provider?: unknown; // EIP-1193 provider
}

export interface PermissionRequest {
  type: string;
  data: Record<string, unknown>;
  expiry?: number;
}

export interface PermissionGrant {
  id: string;
  type: string;
  data: Record<string, unknown>;
  grantedAt: number;
  expiresAt?: number;
}
```

### `sdk/types/solana.d.ts`

```ts
export declare function signInWithSolana(opts: SolanaSignInOptions): Promise<SolanaSignInResult>;
export declare function registerSolanaAgent(opts: SolanaAgentRegistrationOptions): Promise<string>;
export declare function solanaPay(opts: SolanaPayOptions): Promise<SolanaPayResult>;

export interface SolanaSignInOptions {
  walletAdapter: unknown; // @solana/wallet-adapter-base WalletAdapter
  domain?: string;
  statement?: string;
}

export interface SolanaSignInResult {
  address: string;
  signature: string;
  message: string;
}

export interface SolanaAgentRegistrationOptions {
  agentId: string;
  walletAdapter: unknown;
  metadataUri?: string;
}

export interface SolanaPayOptions {
  recipient: string;
  amount: number;
  label?: string;
  message?: string;
  reference?: string;
}

export interface SolanaPayResult {
  signature: string;
  confirmed: boolean;
}
```

### `sdk/types/solana-attestations.d.ts`

```ts
export declare function attestFeedback(opts: AttestFeedbackOptions): Promise<AttestationResult>;
export declare function attestValidation(opts: AttestValidationOptions): Promise<AttestationResult>;

export interface AttestFeedbackOptions {
  agentId: string;
  score: number; // -100 to 100
  comment?: string;
  walletAdapter: unknown;
}

export interface AttestValidationOptions {
  agentId: string;
  passed: boolean;
  proofHash: string;
  proofUri?: string;
  kind: string;
  walletAdapter: unknown;
}

export interface AttestationResult {
  signature: string;
  txHash?: string;
}
```

### `sdk/types/erc8004/abi.d.ts`

```ts
export declare const REGISTRY_DEPLOYMENTS: Record<number, {
  identityRegistry?: string;
  reputationRegistry?: string;
  validationRegistry?: string;
}>;

export declare const IDENTITY_REGISTRY_ABI: readonly unknown[];
export declare const REPUTATION_REGISTRY_ABI: readonly unknown[];
export declare const VALIDATION_REGISTRY_ABI: readonly unknown[];
```

### `sdk/types/erc8004/registry.d.ts`

```ts
export declare function connectWallet(): Promise<WalletConnection>;
export declare function registerAgent(opts: RegisterAgentOptions): Promise<RegisterAgentResult>;
export declare function pinToIPFS(data: unknown): Promise<string>;
export declare function buildRegistrationJSON(opts: RegistrationJSONOptions): AgentRegistrationData;

export interface WalletConnection {
  address: string;
  chainId: number;
  provider: unknown;
  signer: unknown;
}

export interface RegisterAgentOptions {
  agentUri: string;
  chainId?: number;
  metadata?: Array<{ key: string; value: string }>;
  walletConnection?: WalletConnection;
}

export interface RegisterAgentResult {
  agentId: number;
  txHash: string;
  chainId: number;
}

export interface RegistrationJSONOptions {
  name: string;
  description?: string;
  modelUri?: string;
  chainId?: number;
}

export interface AgentRegistrationData {
  name: string;
  description?: string;
  model_uri?: string;
  [key: string]: unknown;
}
```

---

## package.json update

Add to `sdk/package.json`:
```json
{
  "types": "types/index.d.ts",
  "exports": {
    ".": {
      "types": "./types/index.d.ts",
      "import": "./src/index.js"
    }
  }
}
```

---

## Important

**Read each source file before writing its declaration.** The shapes above are based on a code review but may not be 100% accurate. The source is authoritative — declarations must match what actually exists. If a function has additional parameters, include them. If a class has methods not listed above, add them.

If the source uses JSDoc `@typedef` blocks, extract those types into the declaration file.

---

## Acceptance criteria

1. `cd sdk && npx tsc --noEmit --allowJs false --declaration --checkJs false --strict types/index.d.ts` — no errors (or `tsc --noEmit` on a sample consumer).
2. Create a test file `sdk/types/test.ts`:
   ```ts
   import { AgentKit } from '../src/index.js';
   const kit = new AgentKit({ agentId: 'test-123' });
   ```
   `npx tsc --noEmit sdk/types/test.ts` passes (after setting up minimal tsconfig).
3. `sdk/package.json` has `"types": "types/index.d.ts"`.
4. No new JS files added — declarations only.
5. `npx vite build` at repo root still passes.

## Constraints

- Do not convert any `.js` source to TypeScript — declarations only.
- Don't introduce `any` where a real shape is known. Use `unknown` for genuinely opaque values (e.g. wallet adapters).
- Keep declarations minimal — match what the source actually exports, nothing more.
