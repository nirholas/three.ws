---
name: binance-query-address-info
description: Query any on-chain wallet address for token holdings and positions via Binance Web3 API. Retrieves all token balances including price, 24h change, and holding quantity across BSC, Base, and Solana.
license: MIT
metadata:
  category: portfolio
  difficulty: beginner
  author: Binance
  tags: [binance, wallet, address, balance, portfolio, holdings]
---

# Query Address Info Skill

## Overview

This skill queries any on-chain wallet address for token holdings, supporting:
- List of all tokens held by a wallet address
- Current price of each token
- 24-hour price change percentage
- Holding quantity

## API Endpoint

### Query Wallet Token Balance

**Method**: GET

**URL**: 
```
https://web3.binance.com/bapi/defi/v3/public/wallet-direct/buw/wallet/address/pnl/active-position-list
```

**Request Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| address | string | Yes | Wallet address, e.g., `0x0000000000000000000000000000000000000001` |
| chainId | string | Yes | Chain ID, e.g., `56` (BSC), `8453` (Base) |
| offset | number | No | Pagination offset, default 0 |

**Request Headers**:
```
clienttype: web
clientversion: 1.2.0
Accept-Encoding: identity
```

**Example Request**:
```bash
curl --location 'https://web3.binance.com/bapi/defi/v3/public/wallet-direct/buw/wallet/address/pnl/active-position-list?address=0x0000000000000000000000000000000000000001&chainId=56&offset=0' \
--header 'clienttype: web' \
--header 'clientversion: 1.2.0' \
--header 'Accept-Encoding: identity'
```

**Response Example**:
```json
{
    "code": "000000",
    "message": null,
    "messageDetail": null,
    "data": {
        "offset": 0,
        "addressStatus": null,
        "list": [
            {
                "chainId": "56",
                "address": "0x0000000000000000000000000000000000000001",
                "contractAddress": "token contract address",
                "name": "name of token",
                "symbol": "symbol of token",
                "icon": "/images/web3-data/public/token/logos/xxxx.png",
                "decimals": 18,
                "price": "0.0000045375251839978",
                "percentChange24h": "6.84",
                "remainQty": "20"
            }
        ]
    },
    "success": true
}
```

**Response Fields**:

| Field | Type | Description |
|-------|------|-------------|
| chainId | string | Chain ID |
| address | string | Wallet address |
| contractAddress | string | Token contract address |
| name | string | Token name |
| symbol | string | Token symbol |
| icon | string | Token icon URL path |
| decimals | number | Token decimals |
| price | string | Current price (USD) |
| percentChange24h | string | 24-hour price change (%) |
| remainQty | string | Holding quantity |

## Supported Chains

| Chain Name | chainId |
|------------|---------|
| BSC | 56 |
| Base | 8453 |
| Solana | CT_501 |

## Use Cases

1. **Query Wallet Assets**: When users want to view tokens held by a wallet address
2. **Track Holdings**: Monitor wallet token positions
3. **Portfolio Analysis**: Understand wallet asset allocation

## Notes

1. Icon URL requires full domain prefix: `bin.bnbstatic.com` + icon path
2. Price and quantity are string format, convert to numbers when using
3. Use offset parameter for pagination
