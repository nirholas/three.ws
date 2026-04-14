---
mode: agent
description: "Create test infrastructure with unit tests, integration tests, and CI"
---

# Add Test Infrastructure

## Problem

`package.json` defines `"test": "node test/gen_test.js"` but no `test/` directory exists. There are zero tests in the project.

## Implementation

### 1. Test Framework Setup

Install Vitest (matches the Vite build system):

```bash
npm install -D vitest @testing-library/dom jsdom
```

Update `package.json`:
```json
"scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
}
```

Add Vitest config in `vite.config.js`:
```js
test: {
    environment: 'jsdom',
    globals: true,
}
```

### 2. Unit Tests

#### `test/environments.test.js`
- All environments have required fields (id, name)
- EXR environments have valid paths and `.exr` format
- No duplicate IDs or names

#### `test/validator.test.js`
- `escapeHTML()` escapes all dangerous characters
- `linkify()` converts URLs and emails to anchor tags
- `linkify()` does not create links from `javascript:` URIs
- `groupMessages()` correctly aggregates accessor messages
- `setResponse()` escapes `extras.title` (after XSS fix)

#### `test/ipfs.test.js`
- `resolveIpfsUrl()` correctly resolves `ipfs://` URIs
- `resolveIpfsUrl()` correctly resolves `ar://` URIs
- Fallback gateways are tried in order
- Non-IPFS URLs pass through unchanged

#### `test/erc8004/abi.test.js`
- ABI arrays are non-empty
- `agentRegistryId()` formats correctly: `eip155:{chainId}:{address}`
- All deployment entries have the three registry keys

#### `test/components/validator-report.test.js`
- Renders report with all severity levels
- Handles empty reports gracefully
- Renders extras (author, title, license) safely

### 3. Integration Tests

#### `test/viewer.test.js`
- Viewer constructor initializes without errors
- `updateBackground()` sets correct scene background
- `updateEnvironment()` handles all environment options
- Transparent background mode sets alpha correctly

#### `test/app.test.js`
- Hash parsing extracts model URL correctly
- IPFS URL detection works
- Arweave URL detection works

### 4. API Tests (if server is testable)

#### `test/api/mcp.test.js`
- JSON-RPC dispatch routes correctly
- `initialize` returns server info and protocol version
- `tools/list` returns the tool catalog
- Unknown methods return -32601 error
- Invalid JSON-RPC returns -32600 error

### 5. CI Integration

Create `.github/workflows/test.yml`:
```yaml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
      - run: npm run build
```

## File Structure

```
test/
├── environments.test.js
├── validator.test.js
├── ipfs.test.js
├── viewer.test.js
├── app.test.js
├── erc8004/
│   └── abi.test.js
├── components/
│   └── validator-report.test.js
└── api/
    └── mcp.test.js
```

## Validation

- `npm test` runs all tests and passes
- `npm run test:coverage` generates coverage report
- CI workflow runs on push to main
- No test relies on network access (mock fetch where needed)
