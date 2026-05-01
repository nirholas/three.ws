---
name: ethereum-wallet-toolkit-guide
description: Guide to the Ethereum Wallet Toolkit — Python CLI tools and MCP servers for wallet generation, BIP39/BIP44 HD wallets, Web3 Secret Storage V3 keystores, EIP-712 typed data signing, and vanity address generation. Fully offline-capable for maximum security.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, ethereum-wallet-toolkit-guide]
---

# Ethereum Wallet Toolkit Guide

Python toolkit for Ethereum wallets: CLI tools + MCP servers for wallet generation, BIP39/BIP44 HD wallets, keystores, and typed data signing. Designed for offline use.

## Core Features

| Feature | Description | Offline |
|---------|-------------|---------|
| **Wallet Generation** | Create new Ethereum wallets | ✅ |
| **BIP39 Mnemonics** | 12/24-word seed phrases | ✅ |
| **BIP44 HD Wallets** | Derive multiple addresses from one seed | ✅ |
| **Keystores** | Web3 Secret Storage V3 encryption | ✅ |
| **EIP-712 Signing** | Typed structured data signing | ✅ |
| **Vanity Addresses** | Custom-prefix wallet addresses | ✅ |
| **MCP Server** | AI agent interface for all features | ✅ |

## Quick Start

```bash
pip install ethereum-wallet-toolkit
```

## Wallet Generation

### Create a New Wallet

```bash
ethereum-wallet create
# Output:
# Address: 0x742d35Cc6634C0532925a3b844Bc...
# Private Key: 0x4c0883a69102937d62...
# Mnemonic: abandon ability able about above...
```

### From Mnemonic (BIP39)

```python
from ethereum_wallet_toolkit import Wallet

wallet = Wallet.from_mnemonic(
    "abandon ability able about above absent absorb abstract absurd abuse access accident"
)
print(wallet.address)  # 0x...
print(wallet.private_key)  # 0x...
```

### HD Wallet Derivation (BIP44)

```python
from ethereum_wallet_toolkit import HDWallet

hd = HDWallet.from_mnemonic("your 12 words here")

# Derive multiple addresses
for i in range(5):
    child = hd.derive(f"m/44'/60'/0'/0/{i}")
    print(f"Address {i}: {child.address}")
```

Standard Ethereum derivation path: `m/44'/60'/0'/0/index`

## Keystores (Web3 Secret Storage V3)

### Create Keystore

```python
from ethereum_wallet_toolkit import Keystore

# Encrypt private key with password
keystore = Keystore.encrypt(
    private_key="0x4c0883a69102937d...",
    password="my-strong-password"
)

# Save to file
keystore.save("./my-keystore.json")
```

### Decrypt Keystore

```python
wallet = Keystore.decrypt("./my-keystore.json", "my-strong-password")
print(wallet.private_key)
```

## EIP-712 Typed Data Signing

```python
from ethereum_wallet_toolkit import sign_typed_data

# Sign EIP-712 structured data (used by Permit, x402, etc.)
signature = sign_typed_data(
    private_key="0x...",
    domain={
        "name": "Sperax USDs",
        "version": "1",
        "chainId": 42161,
        "verifyingContract": "0xD74f5255D557944cf7Dd0E45FF521520002D5748"
    },
    types={
        "Transfer": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"}
        ]
    },
    message={
        "from": "0xSender",
        "to": "0xRecipient",
        "value": 1000000
    }
)
```

## Vanity Address Generation

```bash
# Find address starting with 0xdead
ethereum-wallet vanity --prefix dead --threads 8

# Find address ending with 1234
ethereum-wallet vanity --suffix 1234 --threads 8
```

Uses multi-threaded search across all CPU cores for fast generation.

## Offline HTML Tool

The toolkit includes `offline1.html` — a single-file, fully offline wallet tool:
- Generate wallets
- Sign transactions
- Create keystores
- No network connection required
- Built with official @ethereumjs libraries

## MCP Server

```json
{
  "mcpServers": {
    "eth-wallet": {
      "command": "ethereum-wallet-toolkit",
      "args": ["mcp"]
    }
  }
}
```

### MCP Tools
- `createWallet` — Generate new wallet
- `fromMnemonic` — Restore from seed phrase
- `deriveChild` — HD wallet derivation
- `signTypedData` — EIP-712 signing
- `createKeystore` — Encrypt to keystore
- `decryptKeystore` — Decrypt keystore

## Security Best Practices

1. **Always generate keys offline** — air-gapped machine preferred
2. **Never share private keys or mnemonics** with anyone including AI agents
3. **Use keystores** for storing keys on disk (password-encrypted)
4. **Backup mnemonics** on physical media (metal plate, paper in safe)
5. **Test with small amounts** before large transfers

## Links

- GitHub: https://github.com/nirholas/ethereum-wallet-toolkit
- BIP39 Spec: https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
- EIP-712: https://eips.ethereum.org/EIPS/eip-712
- Sperax (DeFi on Arbitrum): https://app.sperax.io
