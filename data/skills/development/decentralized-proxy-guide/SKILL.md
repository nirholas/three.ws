---
name: decentralized-proxy-guide
description: Guide to Openbare — a decentralized proxy and relay network. Covers proxy setup, traffic routing, censorship resistance, and privacy-preserving web access. Features SOCKS5, HTTP proxy, and Tor-compatible endpoints.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, decentralized-proxy-guide]
---

# Openbare — Decentralized Proxy Guide

Openbare is a decentralized proxy and relay network for privacy-preserving web access. Features SOCKS5, HTTP proxy, and Tor-compatible endpoints.

## Architecture

```
Client (Browser/App)
    │
    ▼
Openbare Proxy Node (local or remote)
    │
    ├── Direct Route (fast, less private)
    ├── Single Hop (moderate privacy)
    └── Multi-Hop (maximum privacy)
    │
    ▼
Destination Server
```

## Features

| Feature | Description |
|---------|-------------|
| **SOCKS5 Proxy** | Full SOCKS5 proxy protocol |
| **HTTP Proxy** | HTTP/HTTPS proxy mode |
| **Multi-Hop** | Route through multiple nodes |
| **Encryption** | End-to-end encryption between hops |
| **No Logging** | Zero-log policy by design |
| **Self-Hosted** | Run your own relay node |
| **API Access** | Programmatic proxy configuration |

## Quick Start

### Run a Node
```bash
# Install
pip install openbare

# Start a relay node
openbare run --mode relay --port 1080

# Start as SOCKS5 proxy
openbare run --mode socks5 --port 1080

# Start as HTTP proxy
openbare run --mode http --port 8080
```

### Use as Client
```bash
# Configure SOCKS5
export ALL_PROXY=socks5://localhost:1080

# Or HTTP proxy
export HTTP_PROXY=http://localhost:8080
export HTTPS_PROXY=http://localhost:8080

# Test
curl -x socks5://localhost:1080 https://check.torproject.org
```

## Use in Code

### Python
```python
import requests

proxies = {
    'http': 'socks5://localhost:1080',
    'https': 'socks5://localhost:1080'
}

# All requests go through the proxy
response = requests.get('https://api.coingecko.com/api/v3/ping', proxies=proxies)
```

### Node.js
```typescript
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';

const agent = new SocksProxyAgent('socks5://localhost:1080');

const response = await fetch('https://api.coingecko.com/api/v3/ping', { agent });
```

## Multi-Hop Routing

```bash
# Route through 3 nodes for maximum privacy
openbare route --hops 3 --entry node1.openbare.net --exit node3.openbare.net
```

```
Your Device → Node 1 (entry) → Node 2 (relay) → Node 3 (exit) → Internet
              ↑ Knows you       ↑ Knows nothing   ↑ Knows target
              ↓ Not target      ↓ Just relays      ↓ Not you
```

## Use Cases for Crypto

| Use Case | Why |
|----------|-----|
| **RPC Privacy** | Hide IP from blockchain RPC providers |
| **MEV Protection** | Route transactions through private relays |
| **Research** | Access geo-restricted crypto data |
| **Agent Privacy** | AI agents access APIs without IP exposure |
| **DeFi Safety** | Reduce fingerprinting when using DeFi |

## Self-Hosting

```bash
# Docker
docker run -d -p 1080:1080 openbare/node:latest

# Docker Compose
version: '3'
services:
  openbare:
    image: openbare/node:latest
    ports:
      - "1080:1080"
    environment:
      - MODE=relay
      - MAX_CONNECTIONS=100
```

## Links

- GitHub: https://github.com/nirholas/openbare
- Tor Project: https://www.torproject.org
- Sperax: https://app.sperax.io
