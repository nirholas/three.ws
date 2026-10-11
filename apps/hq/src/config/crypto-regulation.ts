/**
 * Static dataset mapping countries to their crypto regulatory stance.
 * Covers 55+ countries including all major economies and crypto hubs.
 */

export type RegulationStance = 'friendly' | 'moderate' | 'restrictive' | 'banned';

export interface CountryRegulation {
  countryCode: string;
  name: string;
  stance: RegulationStance;
  details: string;
  hasFramework: boolean;
  allowsExchanges: boolean;
  allowsStablecoins: boolean;
  taxRate?: string;
}

/** Map stance to RGBA fill color for the GeoJSON overlay */
export const REGULATION_COLORS: Record<RegulationStance, [number, number, number, number]> = {
  friendly: [0, 200, 83, 40],      // Green tint
  moderate: [255, 200, 0, 35],     // Yellow tint
  restrictive: [255, 140, 0, 40],  // Orange tint
  banned: [255, 60, 60, 45],       // Red tint
};

export const COUNTRY_REGULATIONS: CountryRegulation[] = [
  // === Crypto-Friendly ===
  { countryCode: 'AE', name: 'United Arab Emirates', stance: 'friendly', details: 'VARA framework, Dubai crypto hub', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '0%' },
  { countryCode: 'CH', name: 'Switzerland', stance: 'friendly', details: 'Crypto Valley Zug, FINMA regulated', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'MT', name: 'Malta', stance: 'friendly', details: 'Virtual Financial Assets Act (VFA)', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'PT', name: 'Portugal', stance: 'friendly', details: 'No capital gains tax on crypto (individuals)', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '0% (individuals)' },
  { countryCode: 'SV', name: 'El Salvador', stance: 'friendly', details: 'Bitcoin legal tender since 2021', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '0%' },
  { countryCode: 'BS', name: 'Bahamas', stance: 'friendly', details: 'DARE Act; digital asset licensing', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'KY', name: 'Cayman Islands', stance: 'friendly', details: 'VASP regime; major fund domicile', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '0%' },
  { countryCode: 'BM', name: 'Bermuda', stance: 'friendly', details: 'Digital Asset Business Act 2018', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'GI', name: 'Gibraltar', stance: 'friendly', details: 'DLT Provider licensing since 2018', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'LI', name: 'Liechtenstein', stance: 'friendly', details: 'Token and TT Service Provider Act (TVTG)', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'PA', name: 'Panama', stance: 'friendly', details: 'Crypto tax free for individuals', hasFramework: false, allowsExchanges: true, allowsStablecoins: true, taxRate: '0%' },
  { countryCode: 'GE', name: 'Georgia', stance: 'friendly', details: 'No crypto tax; mining hub', hasFramework: false, allowsExchanges: true, allowsStablecoins: true, taxRate: '0%' },
  { countryCode: 'BH', name: 'Bahrain', stance: 'friendly', details: 'CBB crypto framework; regional fintech hub', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },

  // === Moderate ===
  { countryCode: 'US', name: 'United States', stance: 'moderate', details: 'SEC/CFTC regulatory uncertainty, state-by-state', hasFramework: false, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'SG', name: 'Singapore', stance: 'moderate', details: 'MAS licensed, retail restrictions since 2022', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'GB', name: 'United Kingdom', stance: 'moderate', details: 'FCA registered; crypto promotions regime', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'DE', name: 'Germany', stance: 'moderate', details: 'BaFin licensed; MiCA implementation', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'FR', name: 'France', stance: 'moderate', details: 'AMF DASP/PSAN regime; MiCA aligned', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '30%' },
  { countryCode: 'JP', name: 'Japan', stance: 'moderate', details: 'JFSA licensed; stablecoin framework 2023', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'KR', name: 'South Korea', stance: 'moderate', details: 'VASP registration; travel rule enforced', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '20% (from 2025)' },
  { countryCode: 'AU', name: 'Australia', stance: 'moderate', details: 'AUSTRAC registered; licensing framework pending', hasFramework: false, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'CA', name: 'Canada', stance: 'moderate', details: 'CSA/MSB registered; Bitcoin ETFs approved', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'BR', name: 'Brazil', stance: 'moderate', details: 'Central Bank oversight; Legal Framework for Virtual Assets', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'MX', name: 'Mexico', stance: 'moderate', details: 'Fintech Law 2018; Banxico regulated', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'IT', name: 'Italy', stance: 'moderate', details: 'OAM registration; MiCA aligned', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '26%' },
  { countryCode: 'ES', name: 'Spain', stance: 'moderate', details: 'Bank of Spain VASP registry', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'NL', name: 'Netherlands', stance: 'moderate', details: 'DNB registration; strict AML', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'IE', name: 'Ireland', stance: 'moderate', details: 'CBI VASP registration; MiCA aligned', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'SE', name: 'Sweden', stance: 'moderate', details: 'Finansinspektionen registered', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'NO', name: 'Norway', stance: 'moderate', details: 'Finanstilsynet supervised', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'TH', name: 'Thailand', stance: 'moderate', details: 'SEC Thailand licensed; retail restrictions', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '15%' },
  { countryCode: 'PH', name: 'Philippines', stance: 'moderate', details: 'BSP licensed; VASP framework', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'ZA', name: 'South Africa', stance: 'moderate', details: 'FSCA licensed; crypto as financial product', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'NG', name: 'Nigeria', stance: 'moderate', details: 'SEC framework 2024; CBN reversed ban', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'HK', name: 'Hong Kong', stance: 'moderate', details: 'SFC VASP licensing; retail trading allowed 2023', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'TW', name: 'Taiwan', stance: 'moderate', details: 'FSC guidelines; VASP registration', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'IL', name: 'Israel', stance: 'moderate', details: 'ISA & BoI oversight; DeFi sandbox', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'UA', name: 'Ukraine', stance: 'moderate', details: 'Virtual assets law 2022; NSSMC supervised', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'TR', name: 'Turkey', stance: 'moderate', details: 'CMB VASP regulation 2024; payment ban remains', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'AR', name: 'Argentina', stance: 'moderate', details: 'CNV framework; peso instability drives adoption', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'CO', name: 'Colombia', stance: 'moderate', details: 'SFC sandbox; no specific crypto law yet', hasFramework: false, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'CL', name: 'Chile', stance: 'moderate', details: 'Fintech Law 2023; CMF registered', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'NZ', name: 'New Zealand', stance: 'moderate', details: 'FMA oversight; tax on disposal gains', hasFramework: false, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'SI', name: 'Slovenia', stance: 'moderate', details: 'EU MiCA aligned; crypto-friendly tax regime', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'EE', name: 'Estonia', stance: 'moderate', details: 'VASP licensing tightened 2022', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'PL', name: 'Poland', stance: 'moderate', details: 'KNF supervised; MiCA aligned', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'CZ', name: 'Czech Republic', stance: 'moderate', details: 'CNB supervised; MiCA aligned', hasFramework: true, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'AT', name: 'Austria', stance: 'moderate', details: 'FMA licensed; tax reform 2022', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '27.5%' },
  { countryCode: 'KE', name: 'Kenya', stance: 'moderate', details: 'CMA framework pending; growing adoption', hasFramework: false, allowsExchanges: true, allowsStablecoins: true },
  { countryCode: 'SA', name: 'Saudi Arabia', stance: 'moderate', details: 'SAMA caution; no ban; limited framework', hasFramework: false, allowsExchanges: false, allowsStablecoins: true },

  // === Restrictive ===
  { countryCode: 'IN', name: 'India', stance: 'restrictive', details: '30% crypto tax + 1% TDS; hostile regulation', hasFramework: true, allowsExchanges: true, allowsStablecoins: true, taxRate: '30%' },
  { countryCode: 'RU', name: 'Russia', stance: 'restrictive', details: 'Payment ban; mining legalized 2024; cross-border experiments', hasFramework: true, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'ID', name: 'Indonesia', stance: 'restrictive', details: 'Bappebti commodity classification; OJK transition', hasFramework: true, allowsExchanges: true, allowsStablecoins: false },
  { countryCode: 'VN', name: 'Vietnam', stance: 'restrictive', details: 'Payment ban; draft framework pending', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'BD', name: 'Bangladesh', stance: 'restrictive', details: 'Effective ban via AML laws; enforcement limited', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'PK', name: 'Pakistan', stance: 'restrictive', details: 'SBP ban on facilitating; enforcement limited', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'EC', name: 'Ecuador', stance: 'restrictive', details: 'Bitcoin ban for payments; holding allowed', hasFramework: false, allowsExchanges: false, allowsStablecoins: true },
  { countryCode: 'BO', name: 'Bolivia', stance: 'restrictive', details: 'BCB ban on crypto assets; reversed partially 2024', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'EG', name: 'Egypt', stance: 'restrictive', details: 'CBE fatwa/ban; licensing framework under consideration', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'DZ', name: 'Algeria', stance: 'restrictive', details: 'Finance law 2018 ban; underground trading persists', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'MA', name: 'Morocco', stance: 'restrictive', details: 'BAM ban; CBDC exploration; reform expected', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'TN', name: 'Tunisia', stance: 'restrictive', details: 'BCT ban; enforcement limited', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'NP', name: 'Nepal', stance: 'restrictive', details: 'NRB ban; criminal enforcement', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },

  // === Banned ===
  { countryCode: 'CN', name: 'China', stance: 'banned', details: 'Complete ban on crypto trading since 2021', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
  { countryCode: 'QA', name: 'Qatar', stance: 'banned', details: 'QCB & QFC ban on crypto services', hasFramework: false, allowsExchanges: false, allowsStablecoins: false },
];

/** Helper: build a lookup map by country code for fast layer rendering */
export const REGULATION_BY_COUNTRY = new Map<string, CountryRegulation>(
  COUNTRY_REGULATIONS.map(reg => [reg.countryCode, reg]),
);
