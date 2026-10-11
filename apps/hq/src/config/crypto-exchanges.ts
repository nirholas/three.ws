/**
 * Static registry of 40+ major crypto exchanges with HQ locations and regulatory status.
 * Exchange locations don't change frequently - this is config data, not API data.
 * Volume data may be enriched at runtime via CoinGecko.
 */

export type ExchangeStatus = 'licensed' | 'restricted' | 'banned' | 'unregulated' | 'relocated';
export type ExchangeType = 'cex' | 'dex' | 'hybrid';

export interface CryptoExchange {
  id: string;
  name: string;
  type: ExchangeType;
  lat: number;
  lon: number;
  city: string;
  country: string;
  countryCode: string;
  status: ExchangeStatus;
  volume24h?: number;
  founded: number;
  note?: string;
  url: string;
}

export const CRYPTO_EXCHANGES: CryptoExchange[] = [
  // === Major CEXs ===
  {
    id: 'binance', name: 'Binance', type: 'cex',
    lat: 25.2048, lon: 55.2708, city: 'Dubai', country: 'UAE', countryCode: 'AE',
    status: 'licensed', founded: 2017, note: 'HQ relocated multiple times; Dubai since 2022', url: 'https://binance.com',
  },
  {
    id: 'coinbase', name: 'Coinbase', type: 'cex',
    lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'US', countryCode: 'US',
    status: 'licensed', founded: 2012, note: 'NASDAQ listed (COIN)', url: 'https://coinbase.com',
  },
  {
    id: 'kraken', name: 'Kraken', type: 'cex',
    lat: 37.7849, lon: -122.4094, city: 'San Francisco', country: 'US', countryCode: 'US',
    status: 'licensed', founded: 2011, url: 'https://kraken.com',
  },
  {
    id: 'okx', name: 'OKX', type: 'cex',
    lat: 22.3193, lon: 114.1694, city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK',
    status: 'licensed', founded: 2017, note: 'Seychelles registered, HK operations', url: 'https://okx.com',
  },
  {
    id: 'bybit', name: 'Bybit', type: 'cex',
    lat: 25.2148, lon: 55.2808, city: 'Dubai', country: 'UAE', countryCode: 'AE',
    status: 'licensed', founded: 2018, note: 'Relocated from Singapore to Dubai', url: 'https://bybit.com',
  },
  {
    id: 'bitfinex', name: 'Bitfinex', type: 'cex',
    lat: 22.3395, lon: 114.1747, city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK',
    status: 'licensed', founded: 2012, note: 'BVI registered, HK operations; iFinex parent', url: 'https://bitfinex.com',
  },
  {
    id: 'htx', name: 'HTX (Huobi)', type: 'cex',
    lat: 22.3093, lon: 114.1794, city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK',
    status: 'licensed', founded: 2013, note: 'Rebranded from Huobi; relocated from China 2021', url: 'https://htx.com',
  },
  {
    id: 'gate-io', name: 'Gate.io', type: 'cex',
    lat: 22.3293, lon: 114.1594, city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK',
    status: 'licensed', founded: 2013, note: 'Cayman Islands registered', url: 'https://gate.io',
  },
  {
    id: 'kucoin', name: 'KuCoin', type: 'cex',
    lat: -4.3188, lon: 55.4522, city: 'Victoria', country: 'Seychelles', countryCode: 'SC',
    status: 'unregulated', founded: 2017, note: 'Seychelles registered; global operations', url: 'https://kucoin.com',
  },
  {
    id: 'gemini', name: 'Gemini', type: 'cex',
    lat: 40.7128, lon: -74.0060, city: 'New York', country: 'US', countryCode: 'US',
    status: 'licensed', founded: 2014, note: 'NYDFS regulated; Winklevoss twins', url: 'https://gemini.com',
  },
  {
    id: 'bitstamp', name: 'Bitstamp', type: 'cex',
    lat: 46.0569, lon: 14.5058, city: 'Ljubljana', country: 'Slovenia', countryCode: 'SI',
    status: 'licensed', founded: 2011, note: 'Luxembourg licensed; oldest active exchange', url: 'https://bitstamp.net',
  },
  {
    id: 'upbit', name: 'Upbit', type: 'cex',
    lat: 37.5665, lon: 126.9780, city: 'Seoul', country: 'South Korea', countryCode: 'KR',
    status: 'licensed', founded: 2017, note: 'Largest Korean exchange; Dunamu subsidiary', url: 'https://upbit.com',
  },
  {
    id: 'bithumb', name: 'Bithumb', type: 'cex',
    lat: 37.5565, lon: 126.9880, city: 'Seoul', country: 'South Korea', countryCode: 'KR',
    status: 'licensed', founded: 2014, url: 'https://bithumb.com',
  },
  {
    id: 'crypto-com', name: 'Crypto.com', type: 'cex',
    lat: 1.3521, lon: 103.8198, city: 'Singapore', country: 'Singapore', countryCode: 'SG',
    status: 'licensed', founded: 2016, note: 'MAS licensed; formerly Monaco', url: 'https://crypto.com',
  },
  {
    id: 'bitget', name: 'Bitget', type: 'cex',
    lat: -4.3288, lon: 55.4622, city: 'Victoria', country: 'Seychelles', countryCode: 'SC',
    status: 'unregulated', founded: 2018, note: 'Seychelles registered; derivatives focused', url: 'https://bitget.com',
  },
  {
    id: 'mexc', name: 'MEXC', type: 'cex',
    lat: 1.3621, lon: 103.8298, city: 'Singapore', country: 'Singapore', countryCode: 'SG',
    status: 'unregulated', founded: 2018, url: 'https://mexc.com',
  },
  {
    id: 'deribit', name: 'Deribit', type: 'cex',
    lat: -10.1653, lon: -75.0152, city: 'Panama City', country: 'Panama', countryCode: 'PA',
    status: 'unregulated', founded: 2016, note: 'Crypto options/futures leader; Panama registered', url: 'https://deribit.com',
  },
  {
    id: 'bitmex', name: 'BitMEX', type: 'cex',
    lat: -4.3388, lon: 55.4722, city: 'Victoria', country: 'Seychelles', countryCode: 'SC',
    status: 'restricted', founded: 2014, note: 'Seychelles registered; formerly dominant derivatives', url: 'https://bitmex.com',
  },
  {
    id: 'bitflyer', name: 'bitFlyer', type: 'cex',
    lat: 35.6762, lon: 139.6503, city: 'Tokyo', country: 'Japan', countryCode: 'JP',
    status: 'licensed', founded: 2014, note: 'JFSA licensed; largest JP exchange', url: 'https://bitflyer.com',
  },
  {
    id: 'coincheck', name: 'Coincheck', type: 'cex',
    lat: 35.6862, lon: 139.6603, city: 'Tokyo', country: 'Japan', countryCode: 'JP',
    status: 'licensed', founded: 2012, note: 'JFSA licensed; Monex Group subsidiary', url: 'https://coincheck.com',
  },
  {
    id: 'lbank', name: 'LBank', type: 'cex',
    lat: 22.2793, lon: 114.1728, city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK',
    status: 'unregulated', founded: 2015, url: 'https://lbank.com',
  },
  {
    id: 'phemex', name: 'Phemex', type: 'cex',
    lat: 1.3421, lon: 103.8098, city: 'Singapore', country: 'Singapore', countryCode: 'SG',
    status: 'unregulated', founded: 2019, note: 'Founded by ex-Morgan Stanley traders', url: 'https://phemex.com',
  },
  {
    id: 'bitkub', name: 'Bitkub', type: 'cex',
    lat: 13.7563, lon: 100.5018, city: 'Bangkok', country: 'Thailand', countryCode: 'TH',
    status: 'licensed', founded: 2018, note: 'Largest Thai exchange; SEC Thailand licensed', url: 'https://bitkub.com',
  },
  {
    id: 'wazirx', name: 'WazirX', type: 'cex',
    lat: 19.0760, lon: 72.8777, city: 'Mumbai', country: 'India', countryCode: 'IN',
    status: 'restricted', founded: 2018, note: 'Largest Indian exchange; 30% crypto tax', url: 'https://wazirx.com',
  },
  {
    id: 'luno', name: 'Luno', type: 'cex',
    lat: -33.9249, lon: 18.4241, city: 'Cape Town', country: 'South Africa', countryCode: 'ZA',
    status: 'licensed', founded: 2013, note: 'DCG subsidiary; FSCA registered', url: 'https://luno.com',
  },
  {
    id: 'mercado-bitcoin', name: 'Mercado Bitcoin', type: 'cex',
    lat: -23.5505, lon: -46.6333, city: 'São Paulo', country: 'Brazil', countryCode: 'BR',
    status: 'licensed', founded: 2013, note: 'Largest LatAm exchange', url: 'https://mercadobitcoin.com.br',
  },
  {
    id: 'bitso', name: 'Bitso', type: 'cex',
    lat: 19.4326, lon: -99.1332, city: 'Mexico City', country: 'Mexico', countryCode: 'MX',
    status: 'licensed', founded: 2014, note: 'Leading Mexican exchange; Ripple partner', url: 'https://bitso.com',
  },
  {
    id: 'korbit', name: 'Korbit', type: 'cex',
    lat: 37.5765, lon: 126.9680, city: 'Seoul', country: 'South Korea', countryCode: 'KR',
    status: 'licensed', founded: 2013, note: 'Nexon subsidiary', url: 'https://korbit.co.kr',
  },
  {
    id: 'coinone', name: 'Coinone', type: 'cex',
    lat: 37.5465, lon: 126.9580, city: 'Seoul', country: 'South Korea', countryCode: 'KR',
    status: 'licensed', founded: 2014, url: 'https://coinone.co.kr',
  },
  {
    id: 'whitebit', name: 'WhiteBIT', type: 'cex',
    lat: 49.8397, lon: 24.0297, city: 'Lviv', country: 'Ukraine', countryCode: 'UA',
    status: 'licensed', founded: 2018, note: 'Largest European CEX by users', url: 'https://whitebit.com',
  },
  {
    id: 'coinsph', name: 'Coins.ph', type: 'cex',
    lat: 14.5995, lon: 120.9842, city: 'Manila', country: 'Philippines', countryCode: 'PH',
    status: 'licensed', founded: 2014, note: 'BSP licensed; top Southeast Asian exchange', url: 'https://coins.ph',
  },
  {
    id: 'paribu', name: 'Paribu', type: 'cex',
    lat: 41.0082, lon: 28.9784, city: 'Istanbul', country: 'Turkey', countryCode: 'TR',
    status: 'licensed', founded: 2017, note: 'Largest Turkish exchange', url: 'https://paribu.com',
  },

  // === Defunct / Historical (for completeness) ===
  {
    id: 'ftx', name: 'FTX', type: 'cex',
    lat: 25.0343, lon: -77.3963, city: 'Nassau', country: 'Bahamas', countryCode: 'BS',
    status: 'banned', founded: 2019, note: 'Collapsed Nov 2022; SBF convicted of fraud', url: 'https://ftx.com',
  },

  // === Major DEXs (Labs/Foundation HQs) ===
  {
    id: 'uniswap', name: 'Uniswap Labs', type: 'dex',
    lat: 40.7228, lon: -74.0060, city: 'New York', country: 'US', countryCode: 'US',
    status: 'licensed', founded: 2018, note: 'Largest DEX; Ethereum-based AMM', url: 'https://uniswap.org',
  },
  {
    id: 'dydx', name: 'dYdX', type: 'dex',
    lat: 37.7849, lon: -122.3994, city: 'San Francisco', country: 'US', countryCode: 'US',
    status: 'licensed', founded: 2017, note: 'Decentralized perpetuals; migrated to Cosmos', url: 'https://dydx.exchange',
  },
  {
    id: 'hyperliquid', name: 'Hyperliquid', type: 'dex',
    lat: 37.7949, lon: -122.3894, city: 'San Francisco', country: 'US', countryCode: 'US',
    status: 'unregulated', founded: 2023, note: 'L1 perp DEX; own HyperEVM chain', url: 'https://hyperliquid.xyz',
  },
  {
    id: 'jupiter', name: 'Jupiter', type: 'dex',
    lat: 1.3521, lon: 103.8298, city: 'Singapore', country: 'Singapore', countryCode: 'SG',
    status: 'unregulated', founded: 2021, note: 'Top Solana DEX aggregator', url: 'https://jup.ag',
  },
  {
    id: 'raydium', name: 'Raydium', type: 'dex',
    lat: 1.3621, lon: 103.8398, city: 'Singapore', country: 'Singapore', countryCode: 'SG',
    status: 'unregulated', founded: 2021, note: 'Solana AMM; concentrated liquidity', url: 'https://raydium.io',
  },
  {
    id: 'curve', name: 'Curve Finance', type: 'dex',
    lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'Switzerland', countryCode: 'CH',
    status: 'unregulated', founded: 2020, note: 'Stablecoin-optimized AMM; veCRV governance', url: 'https://curve.fi',
  },
  {
    id: 'pancakeswap', name: 'PancakeSwap', type: 'dex',
    lat: 1.3321, lon: 103.7998, city: 'Singapore', country: 'Singapore', countryCode: 'SG',
    status: 'unregulated', founded: 2020, note: 'BNB Chain leading DEX', url: 'https://pancakeswap.finance',
  },
  {
    id: 'sushiswap', name: 'SushiSwap', type: 'dex',
    lat: 35.6962, lon: 139.7003, city: 'Tokyo', country: 'Japan', countryCode: 'JP',
    status: 'unregulated', founded: 2020, note: 'Multi-chain DEX; Uniswap fork origin', url: 'https://sushi.com',
  },
  {
    id: 'aave', name: 'Aave', type: 'dex',
    lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', countryCode: 'GB',
    status: 'unregulated', founded: 2017, note: 'DeFi lending protocol; Avara parent', url: 'https://aave.com',
  },
  {
    id: 'gmx', name: 'GMX', type: 'dex',
    lat: 47.3669, lon: 8.5517, city: 'Zurich', country: 'Switzerland', countryCode: 'CH',
    status: 'unregulated', founded: 2021, note: 'Arbitrum/Avalanche perp DEX', url: 'https://gmx.io',
  },
  {
    id: 'orca', name: 'Orca', type: 'dex',
    lat: 37.7749, lon: -122.4294, city: 'San Francisco', country: 'US', countryCode: 'US',
    status: 'unregulated', founded: 2021, note: 'Solana concentrated liquidity DEX', url: 'https://orca.so',
  },

  // === Hybrid ===
  {
    id: 'hashkey', name: 'HashKey Exchange', type: 'hybrid',
    lat: 22.2893, lon: 114.1594, city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK',
    status: 'licensed', founded: 2023, note: 'SFC licensed (Type 1 & 7); institutional focus', url: 'https://hashkey.com',
  },
  {
    id: 'backpack', name: 'Backpack Exchange', type: 'hybrid',
    lat: 25.2248, lon: 55.2908, city: 'Dubai', country: 'UAE', countryCode: 'AE',
    status: 'licensed', founded: 2023, note: 'VARA licensed; FTX EU acquisition', url: 'https://backpack.exchange',
  },
];
