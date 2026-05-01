---
name: vanity-address-generation
description: Complete mastery guide for cryptographic vanity address generation — understanding how blockchain addresses are derived from private keys (ECDSA, keccak256), brute-force search algorithms, GPU acceleration with OpenCL/CUDA, CREATE2 deterministic deployment for contract vanity addresses, security implications of vanity generation, time/difficulty estimation, multi-chain address formats (Ethereum, Bitcoin, Solana), and practical UX benefits of branded addresses for DAOs and protocols.
license: MIT
metadata:
  category: development
  difficulty: advanced
  author: nich
  tags: [development, vanity-address-generation]
---

# Vanity Address Generation — From Cryptographic Foundations

This skill teaches you everything about generating custom blockchain addresses — from the elliptic curve math that creates them, to the brute-force algorithms that find patterns, to the security considerations that keep them safe.

## What Is a Vanity Address?

A vanity address has a human-chosen pattern in it:

```
Standard:  0x7a3b9c2d1e4f5a6b8c0d9e2f3a4b5c6d7e8f9a0b
Vanity:    0xSperax...                  ← starts with "Sperax"
Vanity:    0x...DEAD                    ← ends with "DEAD"
Vanity:    0x000000...                  ← leading zeros (gas savings!)
```

| Use Case | Example | Why |
|----------|---------|-----|
| **Brand identity** | DAO treasury at `0xSperax...` | Recognizable in block explorers |
| **Gas optimization** | Contract at `0x000000...` | Leading zeros save gas on calldata |
| **Memorability** | Personal wallet `0xNick...` | Easy to verify at a glance |
| **Security verification** | Known prefix for official addresses | Users can spot fakes faster |
| **Collectibility** | Rare patterns like `0xDEADBEEF...` | Fun, flex, verifiable |

## How Addresses Are Born

### Ethereum Address Derivation

```
┌──────────────────────────────────────────────────────┐
│          ETHEREUM ADDRESS DERIVATION                  │
├──────────────────────────────────────────────────────┤
│                                                       │
│  1. Generate random 256-bit private key               │
│     priv = random_bytes(32)                           │
│     e.g., 0xac0974bec39a17e36ba4a6b4d238ff944...     │
│                                                       │
│  2. Derive public key via secp256k1 elliptic curve    │
│     pub = secp256k1(priv)   → 64 bytes (uncompressed)│
│                                                       │
│  3. Hash public key with Keccak-256                   │
│     hash = keccak256(pub)   → 32 bytes                │
│                                                       │
│  4. Take last 20 bytes as address                     │
│     addr = hash[12:]        → 20 bytes = 40 hex chars │
│     → 0x followed by 40 hex characters                │
│                                                       │
│  priv → secp256k1 → pub → keccak256 → addr           │
│  (secret)  (ECDSA)  (point)  (hash)   (public)       │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### The Math Behind secp256k1

```
Elliptic Curve: y² = x³ + 7 (mod p)

Where:
  p = 2²⁵⁶ - 2³² - 977   (a very large prime)
  G = generator point       (a specific point on the curve)
  n = order of G            (number of possible points)

Private key: k (random integer, 1 ≤ k < n)
Public key:  K = k × G     (scalar multiplication on the curve)

This multiplication is:
  - Forward: trivial (milliseconds)
  - Reverse: impossible (discrete logarithm problem)
```

### Why Brute Force Is Required

Because `keccak256` is a one-way function, you cannot compute which private key produces a desired address. You must:

1. Generate a random private key
2. Derive its address
3. Check if the address matches your pattern
4. If not, repeat from step 1

This is computationally identical to mining.

## Difficulty Estimation

### How Hard Is Each Pattern?

Each hex character has 16 possible values (0-9, a-f).

| Pattern | Positions | Expected Attempts | Time (1M/sec) | Time (1B/sec GPU) |
|---------|-----------|-------------------|----------------|-------------------|
| 1 char prefix | 1 | 16 | instant | instant |
| 2 char prefix | 2 | 256 | instant | instant |
| 3 char prefix | 3 | 4,096 | instant | instant |
| 4 char prefix | 4 | 65,536 | ~0.07 sec | instant |
| 5 char prefix | 5 | 1,048,576 | ~1 sec | instant |
| 6 char prefix | 6 | 16,777,216 | ~17 sec | ~0.02 sec |
| 7 char prefix | 7 | 268,435,456 | ~4.5 min | ~0.3 sec |
| 8 char prefix | 8 | 4,294,967,296 | ~72 min | ~4.3 sec |
| "sperax" (6 chars) | 6 | ~16.7 million | ~17 sec | ~0.02 sec |
| "dead" + "beef" | 4+4 | ~4.3 billion × 2 | days | ~minutes |
| 10+ chars | 10+ | > 1 trillion | months-years | days-weeks |

> **Note**: Case-insensitive matching (using EIP-55 checksum) can reduce difficulty by up to 2× for alphabetic characters.

### Formula

```python
def estimate_difficulty(pattern, position="prefix"):
    """Calculate expected attempts for a vanity pattern."""
    # Each hex char: 1/16 probability
    # Case-insensitive letters (a-f): 1/10 for letters, 1/16 for digits
    expected = 1
    for char in pattern:
        if char.lower() in 'abcdef':
            expected *= 10  # Case-insensitive: a or A both match
        else:
            expected *= 16
    return expected

def estimate_time(difficulty, rate_per_second):
    """Average time = difficulty / rate."""
    seconds = difficulty / rate_per_second
    if seconds < 60:
        return f"{seconds:.1f} seconds"
    elif seconds < 3600:
        return f"{seconds/60:.1f} minutes"
    elif seconds < 86400:
        return f"{seconds/3600:.1f} hours"
    else:
        return f"{seconds/86400:.1f} days"
```

## Implementation

### CPU-Based (Simple, Slow)

```python
from eth_keys import keys
from eth_utils import keccak
import os

def find_vanity_address(prefix, suffix=None):
    """Brute-force search for vanity address. CPU-bound."""
    prefix = prefix.lower().replace("0x", "")
    attempts = 0

    while True:
        # 1. Random private key
        private_key_bytes = os.urandom(32)
        private_key = keys.PrivateKey(private_key_bytes)

        # 2. Derive address
        address = private_key.public_key.to_address().lower()

        # 3. Check pattern
        attempts += 1
        matches = True
        if prefix and not address[2:].startswith(prefix):
            matches = False
        if suffix and not address.endswith(suffix):
            matches = False

        if matches:
            return {
                "private_key": private_key_bytes.hex(),
                "address": address,
                "attempts": attempts,
            }

        if attempts % 100_000 == 0:
            print(f"  {attempts:,} attempts...")
```

### GPU-Accelerated (Production Speed)

GPUs parallelize the search across thousands of cores:

```
┌─────────────────────────────────────────────────────┐
│          GPU vs CPU VANITY GENERATION                │
├─────────────────────────────────────────────────────┤
│                                                      │
│  CPU (single core):     ~500K addresses/sec          │
│  CPU (16 cores):        ~8M addresses/sec            │
│  GPU (RTX 3080):        ~500M addresses/sec          │
│  GPU (RTX 4090):        ~1.5B addresses/sec          │
│  GPU cluster (8x4090):  ~12B addresses/sec           │
│                                                      │
│  10-character vanity:                                 │
│  CPU: ~2 years    GPU: ~12 hours    Cluster: ~1 hour │
│                                                      │
└─────────────────────────────────────────────────────┘
```

#### OpenCL Kernel (Simplified)

```c
// Each GPU thread tests a different private key
__kernel void vanity_search(
    __global uchar* results,
    __global uint* found,
    __constant uchar* target_prefix,
    uint prefix_len,
    ulong start_nonce
) {
    uint gid = get_global_id(0);
    ulong nonce = start_nonce + gid;

    // 1. Private key = seed + nonce
    uchar private_key[32];
    generate_key(private_key, nonce);

    // 2. secp256k1 scalar multiplication → public key
    uchar public_key[64];
    ec_multiply(private_key, public_key);

    // 3. keccak256(public_key) → address
    uchar hash[32];
    keccak256(public_key, 64, hash);

    // 4. Check prefix match (last 20 bytes of hash)
    uchar* address = hash + 12;
    if (memcmp(address, target_prefix, prefix_len) == 0) {
        atomic_inc(found);
        copy_to_results(results, gid, private_key, address);
    }
}
```

### CREATE2 for Contract Vanity Addresses

For smart contracts, you can use `CREATE2` to find a vanity deployment address without changing the contract code:

```solidity
// CREATE2 address = keccak256(0xff ++ deployer ++ salt ++ keccak256(bytecode))[12:]
// You brute-force the SALT, not the private key!

contract VanityDeployer {
    function deploy(bytes memory bytecode, bytes32 salt) 
        external 
        returns (address) 
    {
        address deployed;
        assembly {
            deployed := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
        return deployed;
    }

    function predict(bytes memory bytecode, bytes32 salt)
        external
        view
        returns (address)
    {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            salt,
            keccak256(bytecode)
        )))));
    }
}
```

```python
def find_create2_vanity(deployer, bytecode_hash, prefix):
    """Search for CREATE2 salt that produces vanity address."""
    salt = 0
    while True:
        # CREATE2 address computation
        addr = keccak256(
            b'\xff' + 
            bytes.fromhex(deployer[2:]) + 
            salt.to_bytes(32, 'big') + 
            bytes.fromhex(bytecode_hash[2:])
        )[12:]

        if addr.hex().startswith(prefix):
            return hex(salt)
        salt += 1
```

### Leading Zeros = Gas Savings

```
Why protocols like Uniswap use vanity addresses:

Standard address:   0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
Uniswap Router:     0x0000000000000000000000000000000000000001  (theoretical)

In EVM calldata:
  - Non-zero byte = 16 gas
  - Zero byte = 4 gas

A 20-byte address with 4 leading zero bytes saves:
  4 bytes × (16 - 4) = 48 gas per call

For a contract called millions of times, this adds up significantly.
```

## Security Considerations

### CRITICAL: Never Use Online Generators

```
┌─────────────────────────────────────────────────────┐
│              ⚠️  SECURITY WARNING  ⚠️                │
├─────────────────────────────────────────────────────┤
│                                                      │
│  NEVER use a website to generate vanity addresses.   │
│  The site operator sees your private key.            │
│                                                      │
│  NEVER use a closed-source vanity generator.         │
│  It may transmit keys or use weak randomness.        │
│                                                      │
│  ALWAYS:                                             │
│  ✓ Use open-source, audited tools                    │
│  ✓ Run on air-gapped machine                         │
│  ✓ Verify entropy source (os.urandom, /dev/urandom)  │
│  ✓ Wipe keys from memory after use                   │
│  ✓ Test with small amounts first                     │
│                                                      │
│  The Profanity vulnerability (2022) caused $160M+    │
│  in losses due to weak random number generation.     │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### The Profanity Incident

In 2022, the popular vanity generator "Profanity" was found to have a critical flaw: it seeded its PRNG with only 32 bits of entropy, making it possible to brute-force the original private key from just the public address.

**Lesson**: Cryptographic randomness is everything. Use `os.urandom()` or hardware RNG, never `Math.random()` or system clock seeds.

### Defense-in-Depth for Vanity Wallets

```
1. Generate on air-gapped machine
2. Use hardware wallet to manage the key
3. Move to multisig immediately (Gnosis Safe)
4. Never store private key in plaintext
5. Rotate if generator source becomes compromised
```

## Multi-Chain Address Formats

| Chain | Format | Derivation | Vanity Possible? |
|-------|--------|------------|-----------------|
| **Ethereum** | 0x + 40 hex | keccak256(secp256k1(privkey)) | ✅ |
| **Bitcoin** | 1... / 3... / bc1... | RIPEMD160(SHA256(secp256k1)) | ✅ |
| **Solana** | Base58, 32-44 chars | Ed25519 public key | ✅ |
| **Cosmos** | cosmos1... | Bech32(RIPEMD160(SHA256(secp256k1))) | ✅ |
| **Arbitrum** | 0x + 40 hex (same as ETH) | Same as Ethereum | ✅ |

## Sperax Ecosystem Applications

- **DAO Treasury**: Sperax DAO treasury at a `0xSperax...` address makes it instantly recognizable on Arbiscan
- **Protocol Contracts**: USDs contract with leading zeros saves gas on every rebase interaction
- **ERC-8004 Agent Registry**: Agents deployed to vanity addresses are more memorable and trustworthy
- **SPA Staking Contract**: A recognizable address helps users verify they're interacting with the real contract

## Reference Implementation

The `vanity-address-gen` project (by nirholas) provides an open-source, GPU-accelerated vanity address generator supporting Ethereum, Bitcoin, and Solana address formats with proper cryptographic randomness.
