export interface WorldBankIndicator {
  code: string;
  name: string;
}

export interface CountryDataPoint {
  year: string;
  value: number;
}

export interface CountryData {
  code: string;
  name: string;
  values: CountryDataPoint[];
}

export interface LatestValue {
  code: string;
  name: string;
  year: string;
  value: number;
}

export interface WorldBankResponse {
  indicator: string;
  indicatorName: string;
  metadata: {
    page: number;
    pages: number;
    total: number;
  };
  byCountry: Record<string, CountryData>;
  latestByCountry: Record<string, LatestValue>;
  timeSeries: Array<{
    countryCode: string;
    countryName: string;
    year: string;
    value: number;
  }>;
}

export interface IndicatorsResponse {
  indicators: Record<string, string>;
  defaultCountries: string[];
}

const API_BASE = '/api/worldbank';

// Railway relay URL for World Bank proxy (World Bank blocks Vercel IPs)
const wsRelayUrl = import.meta.env.VITE_WS_RELAY_URL || '';
const RAILWAY_WB_URL = wsRelayUrl
  ? wsRelayUrl.replace('wss://', 'https://').replace('ws://', 'http://').replace(/\/$/, '') + '/worldbank'
  : '';

let indicatorsCache: IndicatorsResponse | null = null;
const dataCache = new Map<string, { data: WorldBankResponse; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function wbFetch(qs: string): Promise<Response> {
  // Try Railway first (World Bank blocks Vercel IPs with 403)
  if (RAILWAY_WB_URL) {
    try {
      const resp = await fetch(`${RAILWAY_WB_URL}?${qs}`);
      if (resp.ok) return resp;
    } catch { /* Railway unavailable, fall through */ }
  }
  // Fallback to Vercel edge function
  return fetch(`${API_BASE}?${qs}`);
}

export async function getAvailableIndicators(): Promise<IndicatorsResponse> {
  if (indicatorsCache) return indicatorsCache;

  const response = await wbFetch('action=indicators');
  if (!response.ok) throw new Error('Failed to fetch indicators');

  indicatorsCache = await response.json();
  return indicatorsCache!;
}

export async function getIndicatorData(
  indicator: string,
  options: {
    countries?: string[];
    years?: number;
  } = {}
): Promise<WorldBankResponse> {
  const { countries, years = 5 } = options;

  const cacheKey = `${indicator}-${countries?.join(',') || 'default'}-${years}`;
  const cached = dataCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const params = new URLSearchParams({ indicator, years: years.toString() });
  if (countries?.length) {
    params.set('countries', countries.join(','));
  }

  const response = await wbFetch(params.toString());
  if (!response.ok) throw new Error(`Failed to fetch indicator: ${indicator}`);

  const data = await response.json();
  dataCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

// Preset indicator groups for common use cases
export const INDICATOR_PRESETS = {
  digitalInfrastructure: [
    'IT.NET.USER.ZS',
    'IT.CEL.SETS.P2',
    'IT.NET.BBND.P2',
    'IT.NET.SECR.P6',
  ],
  innovation: [
    'GB.XPD.RSDV.GD.ZS',
    'IP.PAT.RESD',
    'IP.PAT.NRES',
  ],
  techTrade: [
    'TX.VAL.TECH.MF.ZS',
    'BX.GSR.CCIS.ZS',
  ],
  education: [
    'SE.TER.ENRR',
    'SE.XPD.TOTL.GD.ZS',
  ],
} as const;

export interface TechReadinessScore {
  country: string;
  countryName: string;
  score: number;
  rank: number;
  components: {
    internet: number | null;
    mobile: number | null;
    broadband: number | null;
    rdSpend: number | null;
  };
}

export async function getTechReadinessRankings(
  countries?: string[]
): Promise<TechReadinessScore[]> {
  // Fetch multiple indicators in parallel
  // Use 7 years to account for delayed data (R&D often 3-4 years behind)
  const [internet, mobile, broadband, rdSpend] = await Promise.all([
    getIndicatorData('IT.NET.USER.ZS', { countries, years: 5 }),
    getIndicatorData('IT.CEL.SETS.P2', { countries, years: 5 }),
    getIndicatorData('IT.NET.BBND.P2', { countries, years: 5 }),
    getIndicatorData('GB.XPD.RSDV.GD.ZS', { countries, years: 7 }),
  ]);

  // Get all unique countries
  const allCountries = new Set<string>();
  [internet, mobile, broadband, rdSpend].forEach(data => {
    Object.keys(data.latestByCountry).forEach(c => allCountries.add(c));
  });

  // Calculate composite score for each country
  const scores: TechReadinessScore[] = [];

  for (const countryCode of allCountries) {
    const internetVal = internet.latestByCountry[countryCode]?.value;
    const mobileVal = mobile.latestByCountry[countryCode]?.value;
    const broadbandVal = broadband.latestByCountry[countryCode]?.value;
    const rdVal = rdSpend.latestByCountry[countryCode]?.value;

    // Normalize each component to 0-100 scale
    const normalize = (val: number | undefined, max: number): number | null => {
      if (val === undefined || val === null) return null;
      return Math.min(100, (val / max) * 100);
    };

    const components = {
      internet: normalize(internetVal, 100),
      mobile: normalize(mobileVal, 150),
      broadband: normalize(broadbandVal, 50),
      rdSpend: normalize(rdVal, 5),
    };

    // Calculate weighted average (only components with data)
    // Weights: R&D 35%, Internet 30%, Broadband 20%, Mobile 15%
    const weights = { internet: 30, mobile: 15, broadband: 20, rdSpend: 35 };
    let totalWeight = 0;
    let weightedSum = 0;

    for (const [key, weight] of Object.entries(weights)) {
      const val = components[key as keyof typeof components];
      if (val !== null) {
        weightedSum += val * weight;
        totalWeight += weight;
      }
    }

    const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

    const countryName =
      internet.latestByCountry[countryCode]?.name ||
      mobile.latestByCountry[countryCode]?.name ||
      countryCode;

    scores.push({
      country: countryCode,
      countryName,
      score: Math.round(score * 10) / 10,
      rank: 0,
      components,
    });
  }

  // Sort by score and assign ranks
  scores.sort((a, b) => b.score - a.score);
  scores.forEach((s, i) => { s.rank = i + 1; });

  return scores;
}

export async function getCountryComparison(
  indicator: string,
  countryCodes: string[]
): Promise<WorldBankResponse> {
  return getIndicatorData(indicator, { countries: countryCodes, years: 10 });
}
