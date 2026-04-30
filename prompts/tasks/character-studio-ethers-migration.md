# Task: Migrate character-studio from ethers.js v5 to v6

## Context

`/workspaces/3D-Agent/character-studio/package.json` depends on `ethers@^5.7` which reached end-of-life. ethers v6 has breaking API changes. The character-studio appears to be a Three.js-based avatar editor that optionally uses wallet/blockchain features.

## What to do

### 1. Audit actual ethers usage first

```bash
grep -rn "ethers\|provider\|signer\|Contract\|BigNumber\|utils\." /workspaces/3D-Agent/character-studio/src --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" | grep -v node_modules | grep -v ".test."
```

List every ethers v5 API call found. Common breaking changes in v6:
- `ethers.utils.parseEther` → `ethers.parseEther`
- `ethers.utils.formatEther` → `ethers.formatEther`
- `ethers.BigNumber.from` → `BigInt(...)` or `ethers.toBigInt`
- `provider.getGasPrice()` → `provider.getFeeData()`
- `new ethers.providers.Web3Provider` → `new ethers.BrowserProvider`
- `new ethers.providers.JsonRpcProvider` → `new ethers.JsonRpcProvider`
- Contract: `contract.functions.method()` → `contract.method()`

### 2. Update package.json

In `/workspaces/3D-Agent/character-studio/package.json`, change:
```json
"ethers": "^5.7"
```
to:
```json
"ethers": "^6.0"
```

### 3. Apply the API migrations

For each usage found in step 1, apply the corresponding v6 pattern from the list above.

Full migration guide: https://docs.ethers.org/v6/migrating/

### 4. Install and verify

```bash
cd /workspaces/3D-Agent/character-studio
npm install
npm run build
```

Fix any TypeScript or import errors that arise.

### 5. Check @web3-react version

`@web3-react` v6 is also outdated. If it's in package.json, check if it's actually used:
```bash
grep -rn "web3-react\|useWeb3React" /workspaces/3D-Agent/character-studio/src
```
If it's unused, remove it from package.json. If it's used, it may need upgrading to v8 separately — note it in a comment but don't do it in this task.

## Files to edit
- `/workspaces/3D-Agent/character-studio/package.json`
- Any `.js/.ts/.jsx/.tsx` files in `/workspaces/3D-Agent/character-studio/src/` that use ethers

## Verification
- `cd /workspaces/3D-Agent/character-studio && npm run build` completes with no errors
- `grep -r "ethers@5\|from 'ethers/v5'" /workspaces/3D-Agent/character-studio/src` returns nothing
- All existing functionality (avatar loading, any wallet connect) still works
