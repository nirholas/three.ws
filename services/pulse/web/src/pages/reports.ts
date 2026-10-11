import { api } from '../api.ts';
import { empty, errorBox, html, mount, raw, skeleton } from '../ui.ts';
import type { Page } from '../router.ts';

export const reports: Page = async (el) => {
  mount(el, skeleton(6));
  try {
    const { rows } = await api('/reports');
    mount(
      el,
      html`<h1>Daily newsletter</h1><p class="sub">Every issue is archived here exactly as it was sent to Telegram.</p>${rows.length ? html`<div class="tablewrap"><table><thead><tr><th class="l">Day</th><th class="l">Generated</th><th class="l">Telegram</th></tr></thead><tbody>${rows.map((r: any) => html`<tr><td class="l"><a href="#/reports/${r.day}">${String(r.day).slice(0, 10)}</a></td><td class="l">${new Date(r.generated_at).toLocaleString()}</td><td class="l">${r.sent ? 'sent' : 'not sent'}</td></tr>`)}</tbody></table></div>` : empty('No issues yet.', 'The first issue is published after the configured report hour, or run npm run report -- --no-send to generate one now.')}`,
    );
  } catch (e) {
    mount(el, errorBox((e as Error).message));
    el.querySelector('[data-retry]')?.addEventListener('click', () => void reports(el, [], () => {}));
  }
};

export const report: Page = async (el, [day = '']) => {
  mount(el, skeleton(10));
  try {
    const r = await api(`/reports/${day}`);
    mount(el, html`<p><a href="#/reports">Newsletter</a> / ${day}</p><article class="report">${raw(r.html)}</article>`);
  } catch (e) {
    mount(el, errorBox((e as Error).message));
    el.querySelector('[data-retry]')?.addEventListener('click', () => void report(el, [day], () => {}));
  }
};
