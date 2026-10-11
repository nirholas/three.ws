/* ── Known Wallet Registry ── */

export interface KnownWallet {
  address: string;
  label: string;
  type: 'exchange' | 'fund' | 'whale' | 'protocol' | 'bridge' | 'government';
  chain: 'ethereum' | 'bitcoin' | 'multi';
  entity?: string;
}

/** Approximate HQ coordinates for exchanges (for globe layer) */
export interface ExchangeLocation {
  entity: string;
  lat: number;
  lon: number;
}

export const EXCHANGE_LOCATIONS: ExchangeLocation[] = [
  { entity: 'Binance', lat: 25.2048, lon: 55.2708 },       // Dubai
  { entity: 'Coinbase', lat: 37.7749, lon: -122.4194 },     // San Francisco
  { entity: 'Kraken', lat: 37.7749, lon: -122.4194 },       // San Francisco
  { entity: 'OKX', lat: 22.3193, lon: 114.1694 },           // Hong Kong
  { entity: 'Bybit', lat: 25.2048, lon: 55.2708 },          // Dubai
  { entity: 'Bitfinex', lat: 22.3193, lon: 114.1694 },      // Hong Kong
  { entity: 'Gate.io', lat: 1.3521, lon: 103.8198 },        // Singapore
  { entity: 'KuCoin', lat: 1.3521, lon: 103.8198 },         // Singapore
  { entity: 'Gemini', lat: 40.7128, lon: -74.006 },         // New York
  { entity: 'Crypto.com', lat: 1.3521, lon: 103.8198 },     // Singapore
  { entity: 'FTX', lat: 24.5551, lon: -81.7800 },           // Bahamas (historical)
  { entity: 'Robinhood', lat: 37.4849, lon: -122.1483 },    // Menlo Park
  { entity: 'HTX', lat: 1.3521, lon: 103.8198 },            // Singapore
  { entity: 'Bitstamp', lat: 51.5074, lon: -0.1278 },       // London
  { entity: 'US Government', lat: 38.8977, lon: -77.0365 }, // Washington DC
];

export const KNOWN_WALLETS: KnownWallet[] = [
  // ── Binance ──
  { address: '0x28c6c06298d514db089934071355e5743bf21d60', label: 'Binance Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Binance' },
  { address: '0x21a31ee1afc51d94c2efccaa2092ad1028285549', label: 'Binance Hot Wallet 4', type: 'exchange', chain: 'ethereum', entity: 'Binance' },
  { address: '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', label: 'Binance Hot Wallet 6', type: 'exchange', chain: 'ethereum', entity: 'Binance' },
  { address: '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', label: 'Binance Hot Wallet 7', type: 'exchange', chain: 'ethereum', entity: 'Binance' },
  { address: '0xf977814e90da44bfa03b6295a0616a897441acec', label: 'Binance Cold Wallet', type: 'exchange', chain: 'ethereum', entity: 'Binance' },
  { address: '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8', label: 'Binance Cold Wallet 2', type: 'exchange', chain: 'ethereum', entity: 'Binance' },
  { address: '0x5a52e96bacdabb82fd05763e25335261b270efcb', label: 'Binance Hot Wallet 14', type: 'exchange', chain: 'ethereum', entity: 'Binance' },
  { address: '0x835678a611b28684005a5e2233695fb6cbbb0007', label: 'Binance Deposit', type: 'exchange', chain: 'ethereum', entity: 'Binance' },

  // ── Coinbase ──
  { address: '0x503828976d22510aad0201ac7ec88293211d23da', label: 'Coinbase Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Coinbase' },
  { address: '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740', label: 'Coinbase Hot Wallet 2', type: 'exchange', chain: 'ethereum', entity: 'Coinbase' },
  { address: '0x3cd751e6b0078be393132286c442345e68ff0afc', label: 'Coinbase Hot Wallet 3', type: 'exchange', chain: 'ethereum', entity: 'Coinbase' },
  { address: '0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511', label: 'Coinbase Cold Wallet', type: 'exchange', chain: 'ethereum', entity: 'Coinbase' },
  { address: '0xeb2629a2734e272bcc07bda959863f316f4bd4cf', label: 'Coinbase Commerce', type: 'exchange', chain: 'ethereum', entity: 'Coinbase' },
  { address: '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43', label: 'Coinbase 10', type: 'exchange', chain: 'ethereum', entity: 'Coinbase' },

  // ── Kraken ──
  { address: '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', label: 'Kraken Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Kraken' },
  { address: '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0', label: 'Kraken Hot Wallet 4', type: 'exchange', chain: 'ethereum', entity: 'Kraken' },
  { address: '0xda9dfa130df4de4673b89022ee50ff26f6ea73cf', label: 'Kraken Hot Wallet 13', type: 'exchange', chain: 'ethereum', entity: 'Kraken' },

  // ── OKX ──
  { address: '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', label: 'OKX Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'OKX' },
  { address: '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3', label: 'OKX Hot Wallet 2', type: 'exchange', chain: 'ethereum', entity: 'OKX' },
  { address: '0xa7efae728d2936e78bda97dc267687568dd593f3', label: 'OKX Hot Wallet 3', type: 'exchange', chain: 'ethereum', entity: 'OKX' },

  // ── Bybit ──
  { address: '0xf89d7b9c864f589bbf53a82105107622b35eaa40', label: 'Bybit Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Bybit' },
  { address: '0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4', label: 'Bybit Cold Wallet', type: 'exchange', chain: 'ethereum', entity: 'Bybit' },

  // ── Bitfinex ──
  { address: '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa', label: 'Bitfinex Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Bitfinex' },
  { address: '0x742d35cc6634c0532925a3b844bc9e7595f2bd1e', label: 'Bitfinex Cold 2', type: 'exchange', chain: 'ethereum', entity: 'Bitfinex' },

  // ── Gate.io ──
  { address: '0x0d0707963952f2fba59dd06f2b425ace40b492fe', label: 'Gate.io Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Gate.io' },
  { address: '0x1c4b70a3968436b9a0a9cf5205c787eb81bb558c', label: 'Gate.io Hot Wallet 2', type: 'exchange', chain: 'ethereum', entity: 'Gate.io' },

  // ── KuCoin ──
  { address: '0xd6216fc19db775df9774a6e33526131da7d19a2c', label: 'KuCoin Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'KuCoin' },
  { address: '0xf16e9b0d03470827a95cdfd0cb8a8a3b46969b91', label: 'KuCoin Hot Wallet 2', type: 'exchange', chain: 'ethereum', entity: 'KuCoin' },

  // ── Gemini ──
  { address: '0xd24400ae8bfebb18ca49be86258a3c749cf46853', label: 'Gemini Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Gemini' },
  { address: '0x6fc82a5fe25a5cdb58bc74600a40a69c065263f8', label: 'Gemini Hot Wallet 2', type: 'exchange', chain: 'ethereum', entity: 'Gemini' },

  // ── Crypto.com ──
  { address: '0x6262998ced04146fa42253a5c0af90ca02dfd2a3', label: 'Crypto.com Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Crypto.com' },
  { address: '0x46340b20830761efd32832a74d7169b29feb9758', label: 'Crypto.com Cold Wallet', type: 'exchange', chain: 'ethereum', entity: 'Crypto.com' },

  // ── HTX (Huobi) ──
  { address: '0xab5c66752a9e8167967685f1450532fb96d5d24f', label: 'HTX Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'HTX' },
  { address: '0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b', label: 'HTX Hot Wallet 2', type: 'exchange', chain: 'ethereum', entity: 'HTX' },
  { address: '0x18709e89bd403f470088abdacebe86cc60dda12e', label: 'HTX Hot Wallet 3', type: 'exchange', chain: 'ethereum', entity: 'HTX' },

  // ── Bitstamp ──
  { address: '0x00bdb5699745f5b860228c8f939abf1b9ae374ed', label: 'Bitstamp Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Bitstamp' },

  // ── Robinhood ──
  { address: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489', label: 'Robinhood Hot Wallet', type: 'exchange', chain: 'ethereum', entity: 'Robinhood' },

  // ── FTX (estate/recovery) ──
  { address: '0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2', label: 'FTX Recovery', type: 'exchange', chain: 'ethereum', entity: 'FTX' },
  { address: '0xc098b2a3aa256d2140208c3de6543aaef5cd3a94', label: 'FTX Recovery 2', type: 'exchange', chain: 'ethereum', entity: 'FTX' },

  // ── Government seizure wallets ──
  { address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', label: 'US Gov Seized Wallet 1', type: 'government', chain: 'ethereum', entity: 'US Government' },
  { address: '0x49048044d57e1c92a77f79988d21fa8faf74e97e', label: 'US Gov Seized Wallet 2', type: 'government', chain: 'ethereum', entity: 'US Government' },

  // ── Bridges ──
  { address: '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf', label: 'Polygon Bridge', type: 'bridge', chain: 'ethereum', entity: 'Polygon' },
  { address: '0xa3a7b6f88361f48403514059f1f16c8e78d60eec', label: 'Arbitrum Gateway', type: 'bridge', chain: 'ethereum', entity: 'Arbitrum' },
  { address: '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', label: 'Optimism Gateway', type: 'bridge', chain: 'ethereum', entity: 'Optimism' },
  { address: '0x3ee18b2214aff97000d974cf647e7c347e8fa585', label: 'Wormhole Bridge', type: 'bridge', chain: 'ethereum', entity: 'Wormhole' },

  // ── Protocols / Treasuries ──
  { address: '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503', label: 'Binance Peg Tokens', type: 'protocol', chain: 'ethereum', entity: 'Binance' },
  { address: '0x0548f59fee79f8832c299e01dca5c76f034f558e', label: 'Lido Treasury', type: 'protocol', chain: 'ethereum', entity: 'Lido' },
  { address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', label: 'Lido stETH', type: 'protocol', chain: 'ethereum', entity: 'Lido' },

  // ── Known Whales / Funds ──
  { address: '0x8103683202aa8da10536036edef04cdd865c225e', label: 'Jump Trading', type: 'fund', chain: 'ethereum', entity: 'Jump Trading' },
  { address: '0x9b64203878f24eb0cdf55c8c6fa7d08ba0cf77e5', label: 'Wintermute', type: 'fund', chain: 'ethereum', entity: 'Wintermute' },
  { address: '0x0000006daea1723962647b7e189d311d757fb793', label: 'Wintermute 2', type: 'fund', chain: 'ethereum', entity: 'Wintermute' },
  { address: '0xe8c19db00287e3536075114b2576c70773e039bd', label: 'Alameda Research', type: 'fund', chain: 'ethereum', entity: 'Alameda' },
  { address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', label: 'Galaxy Digital', type: 'fund', chain: 'ethereum', entity: 'Galaxy Digital' },
  { address: '0x176f3dab24a159341c0509bb36b833e7fdd0a132', label: 'Cumberland DRW', type: 'fund', chain: 'ethereum', entity: 'Cumberland' },
];

/** Look up a wallet by address (case-insensitive). Returns label info or null. */
export function lookupWallet(address: string): KnownWallet | null {
  const lower = address.toLowerCase();
  return KNOWN_WALLETS.find(w => w.address.toLowerCase() === lower) ?? null;
}

/** Get exchange location for globe mapping */
export function getExchangeLocation(entity: string): ExchangeLocation | null {
  return EXCHANGE_LOCATIONS.find(e => e.entity === entity) ?? null;
}
