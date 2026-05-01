import {
  feCalendar, feTarget, feGrid, feBarChart2,
  fePlay, feActivity, feMessageSquare, feBookOpen,
} from '../../feather.js';

export const modeConfig = {
  schedule: {
    label: 'Schedule task',
    icon: feCalendar,
    placeholder: 'What should we run on a schedule?',
    secondary: { prefix: 'Cadence', default: 'Daily', options: ['Hourly', 'Daily', 'Weekly', 'Custom cron'] },
  },
  research: {
    label: 'Wide Research',
    icon: feTarget,
    placeholder: 'What should we research, in parallel?',
    secondary: { prefix: 'Sources', default: 'Web', options: ['Web', 'Web + Docs', 'Web + Code', 'Custom URLs'] },
  },
  spreadsheet: {
    label: 'Spreadsheet',
    icon: feGrid,
    placeholder: 'Describe the spreadsheet you want to build',
    secondary: { prefix: 'Format', default: 'Google Sheets', options: ['Google Sheets', 'Excel', 'CSV', 'Numbers'] },
  },
  visualization: {
    label: 'Visualization',
    icon: feBarChart2,
    placeholder: 'Describe the chart or dashboard you want',
    secondary: { prefix: 'Style', default: 'Minimal', options: ['Minimal', 'Editorial', 'Dark', 'Print'] },
  },
  video: {
    label: 'Video',
    icon: fePlay,
    placeholder: 'Describe the video you want to create',
    secondary: { prefix: 'Aspect', default: '16:9', options: ['16:9', '9:16', '1:1', '4:5'] },
  },
  audio: {
    label: 'Audio',
    icon: feActivity,
    placeholder: 'Describe the audio you want',
    secondary: { prefix: 'Voice', default: 'Auto', options: ['Auto', 'Specific voices', 'Multi-host'] },
  },
  chat: {
    label: 'Chat mode',
    icon: feMessageSquare,
    placeholder: 'Just chat — no tools, no agents.',
    secondary: null,
  },
  playbook: {
    label: 'Playbook',
    icon: feBookOpen,
    placeholder: 'Describe a multi-step playbook to run',
    secondary: { prefix: 'Tools', default: 'Default', options: ['Default', 'Web only', 'Code only', 'No tools'] },
  },
};

export const schedulePrompts = [
  'Every weekday at 9am, summarize new GitHub issues in repo X',
  'Each Monday, draft a weekly status report from Linear',
  'Every hour, check for new Stripe disputes and email me',
  'Daily at 7pm, post a digest of unread Slack mentions',
  'Weekly on Friday, generate sales pipeline snapshot from CRM',
  'Every 15 minutes, poll uptime for our 3 critical services',
];

export const researchPrompts = [
  'Compare the top 10 vector databases on price, latency, scale',
  'Find every YC W24 company in dev tools with public pricing',
  'Summarize recent papers on LLM evaluation from 2024–2026',
  'List all Series A AI infra startups with announced rounds in Q1',
  'Extract feature parity matrix for Cursor, Claude Code, and three.ws',
  'Find hiring pages of top 50 robotics startups; pull JD for SWE',
];

export const spreadsheetPrompts = [
  'Sales pipeline tracker with weighted forecast',
  'Personal monthly budget with category rollups',
  'Hiring funnel: candidates × stages × dropoff',
  'OKR tracker with quarterly progress',
  'Inventory tracker with reorder points',
  'SaaS metrics dashboard (ARR, MRR, churn)',
];

export const visualizationPrompts = [
  'Stacked bar chart of revenue by region by quarter',
  'Time-series of weekly active users with annotations',
  'Funnel chart for the signup-to-activation flow',
  'Geo heatmap of customer concentration',
  'Cohort retention grid (week-over-week)',
  'Sankey diagram of traffic source → conversion',
];

export const videoPrompts = [
  '30-second product launch teaser with motion graphics',
  '60-second explainer for a B2B SaaS feature',
  'Customer story with overlaid quotes',
  'Conference talk highlight reel',
  'Loop of a UI walkthrough with captions',
  'Short-form vertical reel for Instagram',
];

export const audioPrompts = [
  'Two-host podcast episode (15 min) on agentic coding',
  'Voiceover for a 60-second product demo, calm tone',
  'Soundtrack for a 30-second ad, upbeat and modern',
  'Audio summary of a long article, conversational',
  'Meditation guided session, 10 minutes',
  'Phone IVR greeting in 5 languages',
];

export const playbookPrompts = [
  'Onboard a new SDR: pull rep, send welcome email, schedule training',
  'Triage inbound bug report: dedupe, label, assign, draft reply',
  'Run a weekly RevOps review across CRM, Stripe, and Mixpanel',
  'Migrate a Notion doc tree into a three.ws skill',
  'Audit GitHub repos for missing CI on default branch',
  'End-of-quarter portfolio review for a VC firm',
];

export const gemsPrompts = [
  'What are the top 10 trending tokens on pump.fun right now?',
  'Show me the king of the hill token and analyze its bonding curve',
  'Find tokens launched in the last hour with growing volume',
  'Which tokens have KOL wallets buying right now?',
  'List new tokens with strong momentum but low market cap',
  'Find early gems: high trade velocity, low holder concentration',
];

export const trackPrompts = [
  'Show me a live 3D ticker for SOL with current price and 24h change',
  'Track BTC and render a 30-day 3D price chart',
  'Get the last 50 trades for pump.fun token [mint address]',
  'Show me the bonding curve progress for this token: [mint]',
  'What is the current price, volume, and market cap of ETH?',
  'Display a 90-day 3D price history for Solana',
];

export const portfolioPrompts = [
  'Show my Solana wallet [address] balances as a 3D coin stack',
  'Check my EVM wallet [0x…] and break down each token in USD',
  'Visualize my portfolio allocation as a 3D chart',
  'What are my top 5 holdings by USD value?',
  'Show all my wallet balances across SOL and ETH',
  'Check if any of my tokens have rug risk signals',
];

export const rugcheckPrompts = [
  'Rug check this token: [paste mint address]',
  'Analyze the holder distribution — is this token concentrated?',
  'How much does the dev wallet hold? Any recent dumps?',
  'Show me the bonding curve — is it near graduation or stalling?',
  'Check for suspicious trading patterns on this token',
  'Flag any honeypot signals or locked liquidity issues',
];

export const chart3dPrompts = [
  'Show me a 3D price chart for Bitcoin over the last 30 days',
  'Render a 3D bar chart for Ethereum price history this year',
  'Display a 90-day 3D chart for Solana',
  'Show me a 3D chart for the top trending pump.fun token',
  'Compare SOL price history with a 3D 7-day chart',
  'Render a 3D price visualization for PEPE over 14 days',
];

export const scene3dPrompts = [
  'Make my avatar wave and say hello to everyone',
  'Build a 3D mascot for my token launch',
  'Show a 3D flow diagram for this transaction: [signature]',
  'Import my NFT [mint] into a 3D orbit viewer',
  'Create a token-gated 3D scene for my NFT holders',
  'Mint the current 3D scene as a Solana NFT',
];
