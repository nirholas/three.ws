---
name: x402-agent-payments-guide
description: Guide to the x402 protocol — HTTP-native micropayments for AI agents. Enables agents to pay for API calls, data, and services using stablecoins (USDC, USDs) without API keys or subscriptions. Built on EIP-712 signed payment headers.
license: MIT
metadata:
  category: protocol
  difficulty: intermediate
  author: nich
  tags: [protocol, x402-agent-payments-guide, x402, micropayments, eip-712, stablecoin, agent-payments]
---

# x402 Agent Payments Guide

x402 is the HTTP-native micropayment protocol for AI agents. It enables agents to pay for API calls, data, and services using stablecoins — no API keys, no subscriptions, just a signed payment header.

## How x402 Works

```
Agent → HTTP Request + x402 Payment Header → Server
                                                │
                                            Verify Payment
                                                │
                                            ✅ Valid → Serve Content
                                            ❌ Invalid → 402 Payment Required
```

### The Flow

1. Agent makes HTTP request to a paid endpoint
2. Server returns `402 Payment Required` with pricing info
3. Agent signs an EIP-712 payment authorization
4. Agent retries with `X-402-Payment` header
5. Server verifies signature and serves content
6. Payment settles on-chain (batched for efficiency)

## Payment Header

```http
X-402-Payment: {
  "version": "1",
  "sender": "0xAgentAddress",
  "amount": "0.001",
  "token": "USDs",
  "chain": "arbitrum",
  "signature": "0x...",
  "nonce": 42,
  "expiry": 1735689600
}
```

## Supported Tokens

| Token | Chains | Best For |
|-------|--------|---------|
| **USDs** | Arbitrum | Sperax ecosystem payments |
| **USDC** | Ethereum, Arbitrum, Base | Standard payments |
| **USDT** | Ethereum, Arbitrum | Alternative stablecoin |

## For Agents (Paying)

### Setup

```typescript
import { X402Client } from '@x402/client';

const client = new X402Client({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  defaultToken: 'USDs',
  defaultChain: 'arbitrum',
  maxPaymentPerRequest: '0.01',  // Safety limit
  maxPaymentPerHour: '1.00'       // Hourly limit
});
```

### Making Paid Requests

```typescript
// Automatic payment handling
const response = await client.fetch('https://api.example.com/data', {
  method: 'GET'
});
// If 402 → signs payment → retries → returns data
```

### Budget Controls

```typescript
const client = new X402Client({
  budget: {
    perRequest: '0.01',    // Max per single request
    perHour: '1.00',       // Max per hour
    perDay: '10.00',       // Max per day
    perMonth: '100.00',    // Max per month
    whitelist: ['api.chat.sperax.io', 'api.coingecko.com']  // Trusted domains
  }
});
```

## For Servers (Receiving)

### Express Middleware

```typescript
import { x402Middleware } from '@x402/server';

app.use('/api/premium/*', x402Middleware({
  price: '0.001',      // Price per request in USDs
  token: 'USDs',
  chain: 'arbitrum',
  recipient: '0xYourAddress'
}));

app.get('/api/premium/data', (req, res) => {
  res.json({ data: 'premium content' });
});
```

### Dynamic Pricing

```typescript
app.use('/api/data/*', x402Middleware({
  pricing: (req) => {
    if (req.path.includes('historical')) return '0.005';
    if (req.path.includes('realtime')) return '0.01';
    return '0.001';
  },
  token: 'USDs',
  chain: 'arbitrum'
}));
```

## MCP Integration

x402 is native in the MCP ecosystem:

```json
{
  "mcpServers": {
    "premium-data": {
      "command": "npx",
      "args": ["@premium/mcp-server"],
      "x402": {
        "wallet": "0xAgentWallet",
        "maxBudget": "1.00",
        "token": "USDs"
      }
    }
  }
}
```

## Use Cases

| Use Case | Example | Typical Price |
|----------|---------|---------------|
| **API Calls** | Market data, analytics | $0.001/req |
| **AI Inference** | LLM completions | $0.01-0.10/req |
| **Data Access** | On-chain data, research | $0.005/req |
| **Content** | Paywalled articles, reports | $0.01-0.50 |
| **Tool Usage** | MCP tool invocations | $0.001-0.01 |

## Sperax + x402

USDs is ideal for x402 payments:
- **Auto-yield**: Agent wallets holding USDs earn yield while waiting
- **Low gas**: Arbitrum L2 means sub-cent transaction costs
- **Stable**: Always $1, no price volatility risk

## Links

- Spec: https://www.x402.org
- GitHub: https://github.com/nirholas/x402
- npm: https://www.npmjs.com/package/@x402/client
- EIP-712: https://eips.ethereum.org/EIPS/eip-712
- Sperax USDs: https://app.sperax.io
