export type Page = (el: HTMLElement, params: string[], onCleanup: (fn: () => void) => void) => Promise<void> | void;

export type Route = { pattern: RegExp; page: () => Promise<Page>; nav: string };

export function startRouter(el: HTMLElement, routes: Route[], onNav: (nav: string) => void): void {
  let cleanups: (() => void)[] = [];
  let seq = 0;
  async function render() {
    const id = ++seq;
    cleanups.forEach((fn) => fn());
    cleanups = [];
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path = '/', query = ''] = hash.split('?');
    for (const r of routes) {
      const m = path.match(r.pattern);
      if (!m) continue;
      onNav(r.nav);
      const page = await r.page();
      if (id !== seq) return;
      const params = [...m.slice(1).map(decodeURIComponent)];
      if (query) params.unshift(query);
      el.scrollTop = 0;
      window.scrollTo(0, 0);
      await page(el, params, (fn) => cleanups.push(fn));
      return;
    }
    el.innerHTML = '<div class="empty"><p>Page not found.</p><p><a href="#/">Back to the overview</a></p></div>';
  }
  addEventListener('hashchange', () => void render());
  void render();
}
