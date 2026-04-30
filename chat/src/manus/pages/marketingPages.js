export const marketingPages = {
  'solutions/sales': {
    eyebrow: 'For Sales teams',
    headline: 'Close more deals\nwithout writing more SQL',
    sub: 'Forecasts, dashboards, and outreach drafts — generated from your CRM in minutes.',
    placeholder: 'Describe the sales workflow you want to ship.',
  },
  'solutions/marketing': {
    eyebrow: 'For Marketing teams',
    headline: 'Campaigns, briefs, and analytics\n— drafted in chat',
    sub: 'From brief to launch — generate copy, analyze performance, and iterate without waiting on engineers.',
    placeholder: 'Describe the marketing workflow you want to automate.',
  },
  'solutions/engineering': {
    eyebrow: 'For Engineering teams',
    headline: 'Internal tools your team\nwill actually use',
    sub: 'Build admin panels, deployment dashboards, and incident runbooks — without spinning up a new service.',
    placeholder: 'Describe the internal tool you want to build.',
  },
  'solutions/operations': {
    eyebrow: 'For Operations teams',
    headline: 'Operational reporting\nthat runs itself',
    sub: 'Automate recurring reports, status digests, and cross-team updates so you can focus on decisions, not data wrangling.',
    placeholder: 'Describe the operational report or workflow you need.',
  },
  'solutions/support': {
    eyebrow: 'For Support teams',
    headline: 'Triage, draft, and resolve\n— alongside your humans',
    sub: 'Route tickets, draft responses, and surface knowledge base answers — keeping your team in the loop at every step.',
    placeholder: 'Describe the support workflow you want to improve.',
  },
  'solutions/finance': {
    eyebrow: 'For Finance teams',
    headline: 'Forecasts and spend reviews\non demand',
    sub: 'Pull actuals, model scenarios, and generate board-ready summaries — without exporting another spreadsheet.',
    placeholder: 'Describe the finance report or analysis you need.',
  },
  'solutions/hr': {
    eyebrow: 'For HR teams',
    headline: 'Hiring, onboarding, internal Q&A\n— automated',
    sub: 'Publish job descriptions, answer policy questions, and guide new hires through onboarding — all from one interface.',
    placeholder: 'Describe the HR workflow you want to automate.',
  },
  'solutions/founders': {
    eyebrow: 'For Founders',
    headline: 'Launch the v1 of your idea\nthis weekend',
    sub: 'Go from idea to working prototype in hours — no engineering team required.',
    placeholder: 'Describe the product or tool you want to ship.',
  },
  'business/enterprise': {
    eyebrow: 'For Enterprise',
    headline: 'Launch business applications\nwithout engineering resources',
    sub: 'Give every team the ability to build internal apps, automate workflows, and ship faster — no code required.',
    placeholder: 'Describe the business application you want to launch.',
  },
  'business/security': {
    eyebrow: 'Security & Compliance',
    headline: 'Security and compliance\nyou can show your board',
    sub: 'SOC 2, SSO, audit logs, and data residency controls built in — so your security team can say yes.',
    placeholder: 'Describe your security or compliance requirements.',
  },
  'business/deployments': {
    eyebrow: 'Private Deployments',
    headline: 'Run Manus inside\nyour VPC',
    sub: 'Deploy on your own infrastructure. Your data never leaves your environment.',
    placeholder: 'Tell us about your deployment requirements.',
  },
  'business/customers': {
    eyebrow: 'Customer Stories',
    headline: 'Real teams.\nReal outcomes.',
    sub: 'See how leading organizations use Manus to ship faster and eliminate bottlenecks.',
    placeholder: 'Describe the outcome you\'re looking for.',
  },
  'business/contact-sales': {
    eyebrow: 'Talk to Sales',
    headline: 'Talk to a real human\nabout your rollout',
    sub: 'Whether you\'re evaluating, expanding, or ready to sign — our team is here to help.',
    placeholder: 'Tell us about your team and what you\'re building.',
  },
};

export function getPageContent(slug) {
  if (marketingPages[slug]) return marketingPages[slug];
  const label = slug.split('/').pop().replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    eyebrow: null,
    headline: label,
    sub: 'Explore what Manus can do for your team.',
    placeholder: 'Describe what you want to build.',
  };
}
