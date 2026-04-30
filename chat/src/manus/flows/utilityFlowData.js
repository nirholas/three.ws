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
  'Extract feature parity matrix for Cursor, Claude Code, and Manus',
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
  'Migrate a Notion doc tree into a Manus skill',
  'Audit GitHub repos for missing CI on default branch',
  'End-of-quarter portfolio review for a VC firm',
];
