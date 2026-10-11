/**
 * DetailPanel - slide-over drawer for token / protocol / event / news details.
 *
 * Appends a fixed overlay to document.body (same pattern as CountryBriefPage).
 * Content rendering is delegated to detail renderers that are dynamically imported
 * from `./details/<Type>Detail.ts`.
 */

export type DetailType = 'token' | 'protocol' | 'event' | 'news' | 'country';

export interface DetailPanelOptions {
  onClose?: () => void;
}

interface BreadcrumbEntry {
  type: DetailType;
  data: unknown;
  title: string;
  scrollTop: number;
}

/** Dynamically-imported renderer contract. */
interface DetailRenderer {
  render(container: HTMLElement, data: unknown): void;
  getTitle(data: unknown): string;
}

/* ── Loader map (lazy imports keyed by DetailType) ── */
const RENDERER_LOADERS: Record<DetailType, () => Promise<DetailRenderer>> = {
  token: () => import('@/components/details/TokenDetail').then((m) => m as DetailRenderer),
  protocol: () => import('@/components/details/ProtocolDetail').then((m) => m as DetailRenderer),
  event: () => import('@/components/details/EventDetail').then((m) => m as DetailRenderer),
  news: () => import('@/components/details/NewsDetail').then((m) => m as DetailRenderer),
  country: () => import('@/components/details/CountryDetail').then((m) => m as DetailRenderer),
};

/* ── Helpers ── */

/** Best-effort id extraction from an opaque data payload. */
function extractId(data: unknown): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.id === 'string') return d.id;
    if (typeof d.id === 'number') return String(d.id);
    if (typeof d.symbol === 'string') return d.symbol;
    if (typeof d.slug === 'string') return d.slug;
    if (typeof d.name === 'string') return d.name;
  }
  return '';
}

export class DetailPanel {
  /* ── DOM refs ── */
  private overlay: HTMLElement;
  private drawer: HTMLElement;
  private headerEl: HTMLElement;
  private backBtn: HTMLButtonElement;
  private titleEl: HTMLElement;
  private pinBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private contentEl: HTMLElement;
  private resizeHandle: HTMLElement;

  /* ── State ── */
  private breadcrumbs: BreadcrumbEntry[] = [];
  private visible = false;
  private pinned = false;
  private drawerWidth: number;
  private resizing = false;
  private onCloseCallback?: () => void;

  /* ── Bound listeners (for cleanup) ── */
  private boundKeydown: (e: KeyboardEvent) => void;
  private boundHashChange: (e: HashChangeEvent) => void;

  constructor(options?: DetailPanelOptions) {
    this.onCloseCallback = options?.onClose;

    /* ── Overlay ── */
    this.overlay = document.createElement('div');
    this.overlay.className = 'detail-panel-overlay';
    this.overlay.addEventListener('click', (e) => {
      if ((e.target as HTMLElement) === this.overlay && !this.pinned) this.close();
    });

    /* ── Drawer ── */
    this.drawer = document.createElement('div');
    this.drawer.className = 'detail-panel-drawer';

    // Load saved width
    this.drawerWidth = parseInt(localStorage.getItem('detail-panel-width') || '420', 10);
    this.drawer.style.width = `${this.drawerWidth}px`;

    this.overlay.appendChild(this.drawer);

    // Resize handle (left edge of drawer)
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'detail-panel-resize-handle';
    this.drawer.prepend(this.resizeHandle);

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!this.resizing) return;
      const diff = startX - e.clientX;
      const newWidth = Math.min(Math.max(startWidth + diff, 320), window.innerWidth * 0.8);
      this.drawerWidth = newWidth;
      this.drawer.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      this.resizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('detail-panel-width', String(this.drawerWidth));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this.resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.resizing = true;
      startX = e.clientX;
      startWidth = this.drawerWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    /* ── Header ── */
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'detail-panel-header';

    this.backBtn = document.createElement('button');
    this.backBtn.className = 'detail-panel-back';
    this.backBtn.innerHTML = '&#8592;'; // ← arrow
    this.backBtn.title = 'Back';
    this.backBtn.style.display = 'none';
    this.backBtn.addEventListener('click', () => this.popBreadcrumb());

    this.titleEl = document.createElement('span');
    this.titleEl.className = 'detail-panel-title';

    this.closeBtn = document.createElement('button');
    this.closeBtn.className = 'detail-panel-close';
    this.closeBtn.innerHTML = '&times;';
    this.closeBtn.title = 'Close';
    this.closeBtn.addEventListener('click', () => this.close());

    // Pin button
    this.pinBtn = document.createElement('button');
    this.pinBtn.className = 'detail-panel-pin';
    this.pinBtn.innerHTML = '📌';
    this.pinBtn.title = 'Pin panel open';
    this.pinBtn.addEventListener('click', () => {
      this.pinned = !this.pinned;
      this.pinBtn.classList.toggle('active', this.pinned);
      this.pinBtn.title = this.pinned ? 'Unpin panel' : 'Pin panel open';
      this.overlay.classList.toggle('pinned', this.pinned);
    });

    this.headerEl.appendChild(this.backBtn);
    this.headerEl.appendChild(this.titleEl);
    this.headerEl.appendChild(this.pinBtn);
    this.headerEl.appendChild(this.closeBtn);
    this.drawer.appendChild(this.headerEl);

    /* ── Content (scrollable) ── */
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'detail-panel-content';
    this.drawer.appendChild(this.contentEl);

    /* ── Append to body ── */
    document.body.appendChild(this.overlay);

    /* ── Global listeners ── */
    this.boundKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.visible) this.close();
    };
    document.addEventListener('keydown', this.boundKeydown);

    this.boundHashChange = () => this.handleHashChange();
    window.addEventListener('hashchange', this.boundHashChange);

    // Check hash on construction for deep-link restore
    this.handleHashChange();
  }

  /* ────────────────────── Public API ────────────────────── */

  /** Open the drawer with content for `type`. Pushes onto breadcrumb stack. */
  open(type: DetailType, data: unknown): void {
    // If already showing, save scroll position of current view before pushing
    if (this.breadcrumbs.length > 0) {
      const current = this.breadcrumbs[this.breadcrumbs.length - 1];
      if (current) current.scrollTop = this.contentEl.scrollTop;
    }

    // Show skeleton immediately
    this.showSkeleton();
    this.visible = true;
    this.overlay.classList.add('active');

    // Dynamically import the renderer
    const loader = RENDERER_LOADERS[type];
    if (!loader) {
      this.contentEl.innerHTML = `<p style="color:#888;padding:24px">Unknown detail type: <b>${type}</b></p>`;
      this.titleEl.textContent = type;
      this.pushBreadcrumb(type, data, type);
      this.syncHash(type, data);
      return;
    }

    loader()
      .then((renderer) => {
        const title = renderer.getTitle(data);
        this.titleEl.textContent = title;
        this.contentEl.innerHTML = '';
        this.contentEl.scrollTop = 0;
        this.contentEl.style.opacity = '0';
        renderer.render(this.contentEl, data);
        requestAnimationFrame(() => {
          this.contentEl.style.opacity = '1';
        });
        this.pushBreadcrumb(type, data, title);
        this.syncHash(type, data);
      })
      .catch((err) => {
        console.error(`[DetailPanel] Failed to load renderer for "${type}":`, err);
        this.contentEl.innerHTML = `<p style="color:#888;padding:24px">Could not load detail view.</p>`;
        this.titleEl.textContent = type;
        this.pushBreadcrumb(type, data, type);
        this.syncHash(type, data);
      });
  }

  /** Close the drawer (with animation). */
  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.classList.remove('active');
    this.breadcrumbs = [];
    this.backBtn.style.display = 'none';
    this.clearHash();
    this.onCloseCallback?.();

    // Clear content after transition finishes
    setTimeout(() => {
      if (!this.visible) {
        this.contentEl.innerHTML = '';
        this.titleEl.textContent = '';
      }
    }, 320);
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    document.removeEventListener('keydown', this.boundKeydown);
    window.removeEventListener('hashchange', this.boundHashChange);
    this.overlay.remove();
  }

  /* ────────────────────── Breadcrumb stack ────────────────────── */

  private pushBreadcrumb(type: DetailType, data: unknown, title: string): void {
    this.breadcrumbs.push({ type, data, title, scrollTop: 0 });
    this.backBtn.style.display = this.breadcrumbs.length > 1 ? '' : 'none';
  }

  private popBreadcrumb(): void {
    if (this.breadcrumbs.length <= 1) return;
    this.breadcrumbs.pop();
    const prev = this.breadcrumbs[this.breadcrumbs.length - 1];
    if (!prev) return;
    // Remove the top entry so open() re-pushes it
    const savedScroll = prev.scrollTop;
    this.breadcrumbs.pop();
    this.open(prev.type, prev.data);
    // Restore scroll after render tick
    requestAnimationFrame(() => {
      this.contentEl.scrollTop = savedScroll;
    });
  }

  /* ────────────────────── Skeleton loader ────────────────────── */

  private showSkeleton(): void {
    this.contentEl.innerHTML = `
      <div class="detail-skeleton">
        <div class="detail-skeleton-bar" style="width:60%"></div>
        <div class="detail-skeleton-bar" style="width:90%"></div>
        <div class="detail-skeleton-bar" style="width:45%"></div>
        <div class="detail-skeleton-bar" style="width:75%"></div>
        <div class="detail-skeleton-bar" style="width:50%"></div>
      </div>`;
    this.titleEl.textContent = 'Loading…';
  }

  /* ────────────────────── Hash state ────────────────────── */

  private syncHash(type: DetailType, data: unknown): void {
    const id = extractId(data);
    const fragment = id ? `detail=${type}:${id}` : `detail=${type}`;
    if (location.hash !== `#${fragment}`) {
      history.replaceState(null, '', `#${fragment}`);
    }
  }

  private clearHash(): void {
    if (location.hash.startsWith('#detail=')) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  private handleHashChange(): void {
    const hash = location.hash;
    if (!hash.startsWith('#detail=')) return;
    // Only auto-open if drawer is currently closed (deep-link on load)
    if (this.visible) return;

    const payload = hash.slice('#detail='.length);
    const colonIdx = payload.indexOf(':');
    if (colonIdx === -1) return;

    const type = payload.slice(0, colonIdx) as DetailType;
    const id = payload.slice(colonIdx + 1);
    if (!RENDERER_LOADERS[type]) return;

    // We only have the id - create a minimal stub so the renderer can at least show the id
    this.open(type, { id });
  }

  /* ────────────────────── Static helper ────────────────────── */

  /**
   * Fire the global custom event that App.ts listens for.
   * Any component can call this to open the detail panel.
   */
  static dispatch(type: DetailType, data: unknown): void {
    window.dispatchEvent(
      new CustomEvent('detail:open', { detail: { type, data } }),
    );
  }
}
