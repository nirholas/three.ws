import './style.css';
import { api } from './api.ts';
import { startRouter, type Route } from './router.ts';
import { ago } from './ui.ts';

const NAV = [
  ['overview', '#/', 'Overview'],
  ['tokens', '#/tokens', 'Tokens'],
  ['launches', '#/launches', 'Launches'],
  ['wallets', '#/wallets', 'Wallets'],
  ['reports', '#/reports', 'Newsletter'],
] as const;

const routes: Route[] = [
  { pattern: /^\/$/, nav: 'overview', page: async () => (await import('./pages/overview.ts')).overview },
  { pattern: /^\/tokens$/, nav: 'tokens', page: async () => (await import('./pages/tokens.ts')).tokens },
  { pattern: /^\/token\/([^/]+)\/([^/]+)$/, nav: 'tokens', page: async () => (await import('./pages/token.ts')).token },
  { pattern: /^\/launches$/, nav: 'launches', page: async () => (await import('./pages/launches.ts')).launches },
  { pattern: /^\/wallets$/, nav: 'wallets', page: async () => (await import('./pages/wallets.ts')).wallets },
  { pattern: /^\/wallet\/([^/]+)$/, nav: 'wallets', page: async () => (await import('./pages/wallets.ts')).walletDetail },
  { pattern: /^\/reports$/, nav: 'reports', page: async () => (await import('./pages/reports.ts')).reports },
  { pattern: /^\/reports\/([^/]+)$/, nav: 'reports', page: async () => (await import('./pages/reports.ts')).report },
];

const nav = document.querySelector('#nav')!;
nav.innerHTML = NAV.map(([id, href, label]) => `<a href="${href}" data-nav="${id}">${label}</a>`).join('');

async function pollStatus() {
  const el = document.querySelector('#status')!;
  try {
    const h = await api('/health');
    const live = h.stream?.connected;
    el.innerHTML = `<span class="dot ${live ? 'on' : ''}"></span>${live ? 'Live' : 'Polling'} · last cycle ${h.lastCycle ? ago(h.lastCycle) : 'pending'}`;
  } catch {
    el.innerHTML = '<span class="dot"></span>API unreachable';
  }
}
void pollStatus();
setInterval(() => void pollStatus(), 30_000);

startRouter(document.querySelector('#view')!, routes, (id) => {
  nav.querySelectorAll('a').forEach((a) => (a.dataset.nav === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
});
