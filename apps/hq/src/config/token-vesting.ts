/**
 * Token Vesting Schedule Registry
 *
 * Contains publicly-documented vesting schedules for major crypto tokens.
 * Sources: official tokenomics pages, token unlock trackers, governance docs.
 *
 * Note: Schedules are approximate - actual on-chain unlocks may vary
 * slightly from documented dates. Data current as of Feb 2026.
 */

export interface VestingEvent {
  date: string;           // ISO date (YYYY-MM-DD)
  amount: number;         // Token amount
  percentOfSupply: number; // % of total supply
  recipient: 'team' | 'investors' | 'ecosystem' | 'community' | 'treasury' | 'advisors';
  cliff: boolean;         // Is this a cliff unlock?
  recurring?: 'monthly' | 'quarterly' | 'yearly' | null;
  note?: string;
}

export interface VestingSchedule {
  token: string;
  symbol: string;
  coingeckoId: string;
  totalSupply: number;
  circulatingSupply: number;
  events: VestingEvent[];
  category: 'L1' | 'L2' | 'DeFi' | 'Infrastructure' | 'Gaming';
}

/* ── Helper: generate monthly recurring events ── */
function monthlyEvents(
  startYear: number,
  startMonth: number,
  count: number,
  amount: number,
  percentOfSupply: number,
  recipient: VestingEvent['recipient'],
  day = 16,
): VestingEvent[] {
  const events: VestingEvent[] = [];
  let y = startYear;
  let m = startMonth;
  for (let i = 0; i < count; i++) {
    const mm = String(m).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    events.push({
      date: `${y}-${mm}-${dd}`,
      amount,
      percentOfSupply,
      recipient,
      cliff: false,
      recurring: 'monthly',
    });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return events;
}

export const VESTING_SCHEDULES: VestingSchedule[] = [
  /* ──────────────── L2 Tokens ──────────────── */
  {
    token: 'Arbitrum',
    symbol: 'ARB',
    coingeckoId: 'arbitrum',
    totalSupply: 10_000_000_000,
    circulatingSupply: 4_600_000_000,
    category: 'L2',
    events: [
      // Team & advisor monthly unlocks (~92.65M/mo through Mar 2027)
      ...monthlyEvents(2026, 2, 14, 92_650_000, 0.93, 'team'),
      // Investor monthly unlocks (~62.5M/mo through Mar 2027)
      ...monthlyEvents(2026, 2, 14, 62_500_000, 0.63, 'investors'),
    ],
  },
  {
    token: 'Optimism',
    symbol: 'OP',
    coingeckoId: 'optimism',
    totalSupply: 4_294_967_296,
    circulatingSupply: 1_650_000_000,
    category: 'L2',
    events: [
      // Core contributors monthly (~15.6M/mo)
      ...monthlyEvents(2026, 2, 12, 15_600_000, 0.36, 'team'),
      // Investor unlocks monthly (~10.7M/mo)
      ...monthlyEvents(2026, 2, 12, 10_750_000, 0.25, 'investors', 1),
      // Ecosystem fund quarterly
      { date: '2026-03-31', amount: 42_950_000, percentOfSupply: 1.0, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-06-30', amount: 42_950_000, percentOfSupply: 1.0, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-09-30', amount: 42_950_000, percentOfSupply: 1.0, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-12-31', amount: 42_950_000, percentOfSupply: 1.0, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
    ],
  },
  {
    token: 'Starknet',
    symbol: 'STRK',
    coingeckoId: 'starknet',
    totalSupply: 10_000_000_000,
    circulatingSupply: 2_100_000_000,
    category: 'L2',
    events: [
      // Early contributors monthly (~64M/mo)
      ...monthlyEvents(2026, 2, 12, 64_000_000, 0.64, 'team'),
      // Investor unlocks monthly (~45M/mo)
      ...monthlyEvents(2026, 2, 12, 45_000_000, 0.45, 'investors'),
    ],
  },
  {
    token: 'zkSync',
    symbol: 'ZK',
    coingeckoId: 'zksync',
    totalSupply: 21_000_000_000,
    circulatingSupply: 3_675_000_000,
    category: 'L2',
    events: [
      // Team unlock cliff June 2025, then monthly through 2028
      ...monthlyEvents(2026, 2, 12, 131_250_000, 0.63, 'team', 17),
      // Investor monthly
      ...monthlyEvents(2026, 2, 12, 87_500_000, 0.42, 'investors', 17),
    ],
  },
  {
    token: 'Scroll',
    symbol: 'SCR',
    coingeckoId: 'scroll',
    totalSupply: 1_000_000_000,
    circulatingSupply: 190_000_000,
    category: 'L2',
    events: [
      // Team vesting monthly (~6.9M/mo)
      ...monthlyEvents(2026, 2, 12, 6_944_000, 0.69, 'team'),
      // Investor monthly (~5.2M/mo)
      ...monthlyEvents(2026, 2, 12, 5_208_000, 0.52, 'investors'),
    ],
  },

  /* ──────────────── L1 Tokens ──────────────── */
  {
    token: 'Aptos',
    symbol: 'APT',
    coingeckoId: 'aptos',
    totalSupply: 1_084_721_789,
    circulatingSupply: 580_000_000,
    category: 'L1',
    events: [
      // Core contributors + foundation monthly (~11.3M/mo)
      ...monthlyEvents(2026, 2, 12, 11_310_000, 1.04, 'team', 12),
      // Investor monthly (~8.5M/mo)
      ...monthlyEvents(2026, 2, 12, 8_500_000, 0.78, 'investors', 12),
    ],
  },
  {
    token: 'Sui',
    symbol: 'SUI',
    coingeckoId: 'sui',
    totalSupply: 10_000_000_000,
    circulatingSupply: 3_200_000_000,
    category: 'L1',
    events: [
      // Core team & contributors (~55M/mo)
      ...monthlyEvents(2026, 2, 12, 55_000_000, 0.55, 'team', 1),
      // Early backers (~38M/mo)
      ...monthlyEvents(2026, 2, 12, 38_000_000, 0.38, 'investors', 1),
      // Community reserve quarterly
      { date: '2026-05-01', amount: 75_000_000, percentOfSupply: 0.75, recipient: 'community', cliff: false, recurring: 'quarterly' },
      { date: '2026-08-01', amount: 75_000_000, percentOfSupply: 0.75, recipient: 'community', cliff: false, recurring: 'quarterly' },
      { date: '2026-11-01', amount: 75_000_000, percentOfSupply: 0.75, recipient: 'community', cliff: false, recurring: 'quarterly' },
    ],
  },
  {
    token: 'Sei',
    symbol: 'SEI',
    coingeckoId: 'sei-network',
    totalSupply: 10_000_000_000,
    circulatingSupply: 3_850_000_000,
    category: 'L1',
    events: [
      // Team monthly (~27.8M/mo)
      ...monthlyEvents(2026, 2, 12, 27_780_000, 0.28, 'team', 15),
      // Investor monthly (~20.8M/mo)
      ...monthlyEvents(2026, 2, 12, 20_830_000, 0.21, 'investors', 15),
    ],
  },
  {
    token: 'Celestia',
    symbol: 'TIA',
    coingeckoId: 'celestia',
    totalSupply: 1_000_000_000,
    circulatingSupply: 320_000_000,
    category: 'L1',
    events: [
      // Major cliff unlock Oct 2025 completed; remaining monthly vesting
      // Contributors monthly (~4.2M/mo)
      ...monthlyEvents(2026, 2, 12, 4_167_000, 0.42, 'team', 31),
      // Series A/B investors (~6.25M/mo)
      ...monthlyEvents(2026, 2, 12, 6_250_000, 0.63, 'investors', 31),
    ],
  },
  {
    token: 'Monad',
    symbol: 'MON',
    coingeckoId: 'monad',
    totalSupply: 10_000_000_000,
    circulatingSupply: 1_200_000_000,
    category: 'L1',
    events: [
      // Anticipated monthly unlocks post-TGE (projected)
      ...monthlyEvents(2026, 3, 10, 83_333_000, 0.83, 'team'),
      ...monthlyEvents(2026, 3, 10, 62_500_000, 0.63, 'investors'),
    ],
  },

  /* ──────────────── DeFi Tokens ──────────────── */
  {
    token: 'dYdX',
    symbol: 'DYDX',
    coingeckoId: 'dydx-chain',
    totalSupply: 1_000_000_000,
    circulatingSupply: 580_000_000,
    category: 'DeFi',
    events: [
      // Team & investor monthly unlock (~6.9M/mo through 2026)
      ...monthlyEvents(2026, 2, 12, 6_944_000, 0.69, 'team', 1),
      ...monthlyEvents(2026, 2, 12, 5_556_000, 0.56, 'investors', 1),
    ],
  },
  {
    token: 'Jupiter',
    symbol: 'JUP',
    coingeckoId: 'jupiter-exchange-solana',
    totalSupply: 10_000_000_000,
    circulatingSupply: 2_700_000_000,
    category: 'DeFi',
    events: [
      // Team monthly (~41.7M/mo)
      ...monthlyEvents(2026, 2, 12, 41_667_000, 0.42, 'team'),
      // Ecosystem monthly
      ...monthlyEvents(2026, 2, 12, 27_778_000, 0.28, 'ecosystem'),
    ],
  },
  {
    token: 'Pendle',
    symbol: 'PENDLE',
    coingeckoId: 'pendle',
    totalSupply: 258_446_028,
    circulatingSupply: 160_000_000,
    category: 'DeFi',
    events: [
      // Team vesting weekly (~482K/week → ~2M/mo)
      ...monthlyEvents(2026, 2, 12, 1_930_000, 0.75, 'team', 1),
      // Ecosystem incentives
      ...monthlyEvents(2026, 2, 12, 1_075_000, 0.42, 'ecosystem', 1),
    ],
  },
  {
    token: 'Ethena',
    symbol: 'ENA',
    coingeckoId: 'ethena',
    totalSupply: 15_000_000_000,
    circulatingSupply: 5_850_000_000,
    category: 'DeFi',
    events: [
      // Core team monthly (~62.5M/mo)
      ...monthlyEvents(2026, 2, 12, 62_500_000, 0.42, 'team', 2),
      // Investor monthly (~37.5M/mo)
      ...monthlyEvents(2026, 2, 12, 37_500_000, 0.25, 'investors', 2),
    ],
  },
  {
    token: 'Ondo Finance',
    symbol: 'ONDO',
    coingeckoId: 'ondo-finance',
    totalSupply: 10_000_000_000,
    circulatingSupply: 3_100_000_000,
    category: 'DeFi',
    events: [
      // Cliff unlock Jan 2025 done; now monthly vesting
      ...monthlyEvents(2026, 2, 12, 45_000_000, 0.45, 'team', 18),
      ...monthlyEvents(2026, 2, 12, 30_000_000, 0.30, 'investors', 18),
    ],
  },
  {
    token: 'EigenLayer',
    symbol: 'EIGEN',
    coingeckoId: 'eigenlayer',
    totalSupply: 1_670_000_000,
    circulatingSupply: 310_000_000,
    category: 'DeFi',
    events: [
      // Team cliff passed, monthly vest (~9.7M/mo)
      ...monthlyEvents(2026, 2, 12, 9_722_000, 0.58, 'team', 10),
      // Investor monthly (~6.9M/mo)
      ...monthlyEvents(2026, 2, 12, 6_944_000, 0.42, 'investors', 10),
    ],
  },
  {
    token: 'Aave',
    symbol: 'AAVE',
    coingeckoId: 'aave',
    totalSupply: 16_000_000,
    circulatingSupply: 15_000_000,
    category: 'DeFi',
    events: [
      // Ecosystem reserve quarterly allocations
      { date: '2026-04-01', amount: 50_000, percentOfSupply: 0.31, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-07-01', amount: 50_000, percentOfSupply: 0.31, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
      { date: '2026-10-01', amount: 50_000, percentOfSupply: 0.31, recipient: 'ecosystem', cliff: false, recurring: 'quarterly' },
    ],
  },

  /* ──────────────── Infrastructure ──────────────── */
  {
    token: 'Pyth Network',
    symbol: 'PYTH',
    coingeckoId: 'pyth-network',
    totalSupply: 10_000_000_000,
    circulatingSupply: 3_600_000_000,
    category: 'Infrastructure',
    events: [
      // Core contributor monthly (~27.8M/mo)
      ...monthlyEvents(2026, 2, 12, 27_778_000, 0.28, 'team', 20),
      // Investor monthly (~20.8M/mo)
      ...monthlyEvents(2026, 2, 12, 20_833_000, 0.21, 'investors', 20),
    ],
  },
  {
    token: 'Worldcoin',
    symbol: 'WLD',
    coingeckoId: 'worldcoin-wld',
    totalSupply: 10_000_000_000,
    circulatingSupply: 1_150_000_000,
    category: 'Infrastructure',
    events: [
      // Community allocation daily (large ongoing unlock)
      // Simplified to monthly aggregate (~100M/mo community)
      ...monthlyEvents(2026, 2, 12, 100_000_000, 1.0, 'community', 24),
      // TFH/team monthly (~20.8M/mo)
      ...monthlyEvents(2026, 2, 12, 20_833_000, 0.21, 'team', 24),
    ],
  },
  {
    token: 'Wormhole',
    symbol: 'W',
    coingeckoId: 'wormhole',
    totalSupply: 10_000_000_000,
    circulatingSupply: 2_500_000_000,
    category: 'Infrastructure',
    events: [
      // Core contributors monthly (~33.3M/mo)
      ...monthlyEvents(2026, 2, 12, 33_333_000, 0.33, 'team', 3),
      // Strategic partners monthly (~25M/mo)
      ...monthlyEvents(2026, 2, 12, 25_000_000, 0.25, 'investors', 3),
    ],
  },
  {
    token: 'LayerZero',
    symbol: 'ZRO',
    coingeckoId: 'layerzero',
    totalSupply: 1_000_000_000,
    circulatingSupply: 250_000_000,
    category: 'Infrastructure',
    events: [
      // Core contributors monthly (~5.6M/mo)
      ...monthlyEvents(2026, 2, 12, 5_556_000, 0.56, 'team', 20),
      // Investor monthly (~4.2M/mo)
      ...monthlyEvents(2026, 2, 12, 4_167_000, 0.42, 'investors', 20),
    ],
  },
  {
    token: 'Immutable',
    symbol: 'IMX',
    coingeckoId: 'immutable-x',
    totalSupply: 2_000_000_000,
    circulatingSupply: 1_650_000_000,
    category: 'Infrastructure',
    events: [
      // Ecosystem development monthly (~8.3M/mo)
      ...monthlyEvents(2026, 2, 12, 8_333_000, 0.42, 'ecosystem', 22),
      // Project development monthly
      ...monthlyEvents(2026, 2, 12, 5_556_000, 0.28, 'team', 22),
    ],
  },
  {
    token: 'Jito',
    symbol: 'JTO',
    coingeckoId: 'jito-governance-token',
    totalSupply: 1_000_000_000,
    circulatingSupply: 350_000_000,
    category: 'Infrastructure',
    events: [
      // Core contributors monthly (~5.6M/mo)
      ...monthlyEvents(2026, 2, 12, 5_556_000, 0.56, 'team', 7),
      // Investor monthly (~4.2M/mo)
      ...monthlyEvents(2026, 2, 12, 4_167_000, 0.42, 'investors', 7),
    ],
  },
  {
    token: 'Ethfi',
    symbol: 'ETHFI',
    coingeckoId: 'ether-fi',
    totalSupply: 1_000_000_000,
    circulatingSupply: 310_000_000,
    category: 'DeFi',
    events: [
      // Team monthly (~6.9M/mo)
      ...monthlyEvents(2026, 2, 12, 6_944_000, 0.69, 'team', 18),
      // Investor monthly (~4.9M/mo)
      ...monthlyEvents(2026, 2, 12, 4_861_000, 0.49, 'investors', 18),
      // DAO treasury quarterly
      { date: '2026-03-18', amount: 12_500_000, percentOfSupply: 1.25, recipient: 'treasury', cliff: false, recurring: 'quarterly' },
      { date: '2026-06-18', amount: 12_500_000, percentOfSupply: 1.25, recipient: 'treasury', cliff: false, recurring: 'quarterly' },
      { date: '2026-09-18', amount: 12_500_000, percentOfSupply: 1.25, recipient: 'treasury', cliff: false, recurring: 'quarterly' },
      { date: '2026-12-18', amount: 12_500_000, percentOfSupply: 1.25, recipient: 'treasury', cliff: false, recurring: 'quarterly' },
    ],
  },
  {
    token: 'Manta Network',
    symbol: 'MANTA',
    coingeckoId: 'manta-network',
    totalSupply: 1_000_000_000,
    circulatingSupply: 430_000_000,
    category: 'L2',
    events: [
      // Team monthly (~4.2M/mo)
      ...monthlyEvents(2026, 2, 12, 4_167_000, 0.42, 'team', 18),
      // Investors monthly (~3.5M/mo)
      ...monthlyEvents(2026, 2, 12, 3_472_000, 0.35, 'investors', 18),
    ],
  },
  {
    token: 'Altlayer',
    symbol: 'ALT',
    coingeckoId: 'altlayer',
    totalSupply: 10_000_000_000,
    circulatingSupply: 3_200_000_000,
    category: 'Infrastructure',
    events: [
      // Team vest monthly (~41.7M/mo)
      ...monthlyEvents(2026, 2, 12, 41_667_000, 0.42, 'team', 25),
      // Investor monthly (~27.8M/mo)
      ...monthlyEvents(2026, 2, 12, 27_778_000, 0.28, 'investors', 25),
    ],
  },
  {
    token: 'Pixels',
    symbol: 'PIXEL',
    coingeckoId: 'pixels',
    totalSupply: 5_000_000_000,
    circulatingSupply: 1_400_000_000,
    category: 'Gaming',
    events: [
      // Ecosystem monthly (~20.8M/mo)
      ...monthlyEvents(2026, 2, 12, 20_833_000, 0.42, 'ecosystem', 19),
      // Team monthly (~13.9M/mo)
      ...monthlyEvents(2026, 2, 12, 13_889_000, 0.28, 'team', 19),
    ],
  },
  {
    token: 'Portal',
    symbol: 'PORTAL',
    coingeckoId: 'portal-2',
    totalSupply: 1_000_000_000,
    circulatingSupply: 280_000_000,
    category: 'Gaming',
    events: [
      // Team monthly (~5.6M/mo)
      ...monthlyEvents(2026, 2, 12, 5_556_000, 0.56, 'team', 22),
      // Investor monthly (~4.2M/mo)
      ...monthlyEvents(2026, 2, 12, 4_167_000, 0.42, 'investors', 22),
    ],
  },

  /* ──────────────── Additional DeFi ──────────────── */
  {
    token: 'Drift Protocol',
    symbol: 'DRIFT',
    coingeckoId: 'drift-protocol',
    totalSupply: 1_000_000_000,
    circulatingSupply: 270_000_000,
    category: 'DeFi',
    events: [
      ...monthlyEvents(2026, 2, 12, 5_556_000, 0.56, 'team', 16),
      ...monthlyEvents(2026, 2, 12, 4_167_000, 0.42, 'investors', 16),
    ],
  },
  {
    token: 'Parcl',
    symbol: 'PRCL',
    coingeckoId: 'parcl',
    totalSupply: 1_000_000_000,
    circulatingSupply: 200_000_000,
    category: 'DeFi',
    events: [
      ...monthlyEvents(2026, 2, 12, 6_250_000, 0.63, 'team', 15),
      ...monthlyEvents(2026, 2, 12, 4_861_000, 0.49, 'investors', 15),
    ],
  },
];
