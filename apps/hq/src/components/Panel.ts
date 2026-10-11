import { escapeHtml } from '../utils/sanitize';
import { isMobileDevice } from '../utils';

export interface PanelOptions {
  id: string;
  title: string;
  showCount?: boolean;
  className?: string;
  trackActivity?: boolean;
  infoTooltip?: string;
}

const PANEL_SPANS_KEY = 'hq-panel-spans';
const PANEL_COL_SPANS_KEY = 'hq-panel-col-spans';

function loadPanelSpans(): Record<string, number> {
  try {
    const stored = localStorage.getItem(PANEL_SPANS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function savePanelSpan(panelId: string, span: number): void {
  const spans = loadPanelSpans();
  spans[panelId] = span;
  localStorage.setItem(PANEL_SPANS_KEY, JSON.stringify(spans));
}

function loadPanelColSpans(): Record<string, number> {
  try {
    const stored = localStorage.getItem(PANEL_COL_SPANS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function savePanelColSpan(panelId: string, colSpan: number): void {
  const spans = loadPanelColSpans();
  spans[panelId] = colSpan;
  localStorage.setItem(PANEL_COL_SPANS_KEY, JSON.stringify(spans));
}

function heightToSpan(height: number): number {
  // Much lower thresholds for responsive resizing
  // Start at 200px, so:
  // - 50px drag → span 2 (250px)
  // - 150px drag → span 3 (350px)
  // - 300px drag → span 4 (500px)
  if (height >= 500) return 4;
  if (height >= 350) return 3;
  if (height >= 250) return 2;
  return 1;
}

function setSpanClass(element: HTMLElement, span: number): void {
  element.classList.remove('span-1', 'span-2', 'span-3', 'span-4');
  element.classList.add(`span-${span}`);
  element.classList.add('resized');
}

function setColSpanClass(element: HTMLElement, colSpan: number): void {
  element.classList.remove('col-span-1', 'col-span-2', 'col-span-3');
  if (colSpan > 1) {
    element.classList.add(`col-span-${colSpan}`);
  }
}

function widthToColSpan(width: number, gridColWidth: number): number {
  if (gridColWidth <= 0) return 1;
  const ratio = width / gridColWidth;
  if (ratio >= 2.5) return 3;
  if (ratio >= 1.5) return 2;
  return 1;
}

export class Panel {
  protected element: HTMLElement;
  protected content: HTMLElement;
  protected header: HTMLElement;
  protected countEl: HTMLElement | null = null;
  protected statusBadgeEl: HTMLElement | null = null;
  protected newBadgeEl: HTMLElement | null = null;
  protected panelId: string;
  private tooltipCloseHandler: (() => void) | null = null;
  private resizeHandle: HTMLElement | null = null;
  private resizeHandleRight: HTMLElement | null = null;
  private isResizing = false;
  private isResizingH = false;
  private startY = 0;
  private startX = 0;
  private startHeight = 0;
  private startWidth = 0;
  private onTouchMove: ((e: TouchEvent) => void) | null = null;
  private onTouchEnd: (() => void) | null = null;
  private onDocMouseUp: (() => void) | null = null;

  constructor(options: PanelOptions) {
    this.panelId = options.id;
    this.element = document.createElement('div');
    this.element.className = `panel ${options.className || ''}`;
    this.element.dataset.panel = options.id;

    this.header = document.createElement('div');
    this.header.className = 'panel-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'panel-header-left';

    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = options.title;
    headerLeft.appendChild(title);

    if (options.infoTooltip) {
      const infoBtn = document.createElement('button');
      infoBtn.className = 'panel-info-btn';
      infoBtn.innerHTML = '?';
      infoBtn.setAttribute('aria-label', 'Show methodology info');

      const tooltip = document.createElement('div');
      tooltip.className = 'panel-info-tooltip';
      tooltip.innerHTML = options.infoTooltip;

      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tooltip.classList.toggle('visible');
      });

      this.tooltipCloseHandler = () => tooltip.classList.remove('visible');
      document.addEventListener('click', this.tooltipCloseHandler);

      const infoWrapper = document.createElement('div');
      infoWrapper.className = 'panel-info-wrapper';
      infoWrapper.appendChild(infoBtn);
      infoWrapper.appendChild(tooltip);
      headerLeft.appendChild(infoWrapper);
    }

    // Add "new" badge element (hidden by default)
    if (options.trackActivity !== false) {
      this.newBadgeEl = document.createElement('span');
      this.newBadgeEl.className = 'panel-new-badge';
      this.newBadgeEl.style.display = 'none';
      headerLeft.appendChild(this.newBadgeEl);
    }

    this.header.appendChild(headerLeft);

    this.statusBadgeEl = document.createElement('span');
    this.statusBadgeEl.className = 'panel-data-badge';
    this.statusBadgeEl.style.display = 'none';
    this.header.appendChild(this.statusBadgeEl);

    if (options.showCount) {
      this.countEl = document.createElement('span');
      this.countEl.className = 'panel-count';
      this.countEl.textContent = '0';
      this.header.appendChild(this.countEl);
    }

    this.content = document.createElement('div');
    this.content.className = 'panel-content';
    this.content.id = `${options.id}Content`;

    this.element.appendChild(this.header);
    this.element.appendChild(this.content);

    // Add bottom resize handle (vertical)
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'panel-resize-handle';
    this.resizeHandle.title = 'Drag to resize height (double-click to reset)';
    this.resizeHandle.draggable = false;
    this.element.appendChild(this.resizeHandle);

    // Add right resize handle (horizontal) - skip on mobile (column spanning doesn't work on single-column grids)
    if (!isMobileDevice()) {
      this.resizeHandleRight = document.createElement('div');
      this.resizeHandleRight.className = 'panel-resize-handle-right';
      this.resizeHandleRight.title = 'Drag to resize width (double-click to reset)';
      this.resizeHandleRight.draggable = false;
      this.element.appendChild(this.resizeHandleRight);
    }

    this.setupResizeHandlers();

    // Restore saved spans
    const savedSpans = loadPanelSpans();
    const savedSpan = savedSpans[this.panelId];
    if (savedSpan && savedSpan > 1) {
      setSpanClass(this.element, savedSpan);
    }
    const savedColSpans = loadPanelColSpans();
    const savedColSpan = savedColSpans[this.panelId];
    if (savedColSpan && savedColSpan > 1) {
      setColSpanClass(this.element, savedColSpan);
    }

    this.showLoading();
  }

  private setupResizeHandlers(): void {
    if (!this.resizeHandle) return;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.isResizing = true;
      this.startY = e.clientY;
      this.startHeight = this.element.getBoundingClientRect().height;
      this.element.classList.add('resizing');
      this.element.draggable = false;
      this.resizeHandle?.classList.add('active');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isResizing) return;
      const deltaY = e.clientY - this.startY;
      const newHeight = Math.max(200, this.startHeight + deltaY);
      const span = heightToSpan(newHeight);
      setSpanClass(this.element, span);
    };

    const onMouseUp = () => {
      if (!this.isResizing) return;
      this.isResizing = false;
      this.element.classList.remove('resizing');
      this.element.draggable = true;
      this.resizeHandle?.classList.remove('active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      const currentSpan = this.element.classList.contains('span-4') ? 4 :
                          this.element.classList.contains('span-3') ? 3 :
                          this.element.classList.contains('span-2') ? 2 : 1;
      savePanelSpan(this.panelId, currentSpan);
    };

    this.resizeHandle.addEventListener('mousedown', onMouseDown);

    // Prevent panel drag when resizing (capture phase runs before App.ts listener)
    this.element.addEventListener('dragstart', (e) => {
      const target = e.target as HTMLElement;
      if (this.isResizing || target === this.resizeHandle || target.closest('.panel-resize-handle')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
      }
    }, true);

    // Mark element as resizing for external listeners
    this.resizeHandle.addEventListener('mousedown', () => {
      this.element.dataset.resizing = 'true';
    });

    // Double-click to reset
    this.resizeHandle.addEventListener('dblclick', () => {
      this.resetHeight();
    });

    // Touch support
    this.resizeHandle.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const touch = e.touches[0];
      if (!touch) return;
      this.isResizing = true;
      this.startY = touch.clientY;
      this.startHeight = this.element.getBoundingClientRect().height;
      this.element.classList.add('resizing');
      this.element.draggable = false;
      this.element.dataset.resizing = 'true';
      this.resizeHandle?.classList.add('active');
    }, { passive: false });

    // Use bound handlers so they can be removed in destroy()
    this.onTouchMove = (e: TouchEvent) => {
      if (!this.isResizing) return;
      const touch = e.touches[0];
      if (!touch) return;
      const deltaY = touch.clientY - this.startY;
      const newHeight = Math.max(200, this.startHeight + deltaY);
      const span = heightToSpan(newHeight);
      setSpanClass(this.element, span);
    };

    this.onTouchEnd = () => {
      if (!this.isResizing) return;
      this.isResizing = false;
      this.element.classList.remove('resizing');
      this.element.draggable = true;
      delete this.element.dataset.resizing;
      this.resizeHandle?.classList.remove('active');
      const currentSpan = this.element.classList.contains('span-4') ? 4 :
                          this.element.classList.contains('span-3') ? 3 :
                          this.element.classList.contains('span-2') ? 2 : 1;
      savePanelSpan(this.panelId, currentSpan);
    };

    this.onDocMouseUp = () => {
      if (this.element.dataset.resizing) {
        delete this.element.dataset.resizing;
      }
    };

    document.addEventListener('touchmove', this.onTouchMove, { passive: false });
    document.addEventListener('touchend', this.onTouchEnd);
    document.addEventListener('mouseup', this.onDocMouseUp);

    // ── Horizontal resize (right handle) ──
    if (this.resizeHandleRight) {
      const rightHandle = this.resizeHandleRight;

      const getGridColWidth = (): number => {
        const grid = this.element.parentElement;
        if (!grid) return 280;
        const cols = getComputedStyle(grid).gridTemplateColumns.split(' ');
        return parseFloat(cols[0] ?? '280') || 280;
      };

      const onRightDown = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.isResizingH = true;
        this.startX = e.clientX;
        this.startWidth = this.element.getBoundingClientRect().width;
        this.element.classList.add('resizing-h');
        this.element.draggable = false;
        this.element.dataset.resizing = 'true';
        rightHandle.classList.add('active');
        document.addEventListener('mousemove', onRightMove);
        document.addEventListener('mouseup', onRightUp);
      };

      const onRightMove = (e: MouseEvent) => {
        if (!this.isResizingH) return;
        const deltaX = e.clientX - this.startX;
        const newWidth = this.startWidth + deltaX;
        const colSpan = widthToColSpan(newWidth, getGridColWidth());
        setColSpanClass(this.element, colSpan);
      };

      const onRightUp = () => {
        if (!this.isResizingH) return;
        this.isResizingH = false;
        this.element.classList.remove('resizing-h');
        this.element.draggable = true;
        delete this.element.dataset.resizing;
        rightHandle.classList.remove('active');
        document.removeEventListener('mousemove', onRightMove);
        document.removeEventListener('mouseup', onRightUp);
        const colSpan = this.element.classList.contains('col-span-3') ? 3 :
                        this.element.classList.contains('col-span-2') ? 2 : 1;
        savePanelColSpan(this.panelId, colSpan);
      };

      rightHandle.addEventListener('mousedown', onRightDown);

      rightHandle.addEventListener('dblclick', () => {
        this.element.classList.remove('col-span-1', 'col-span-2', 'col-span-3');
        const spans = loadPanelColSpans();
        delete spans[this.panelId];
        localStorage.setItem(PANEL_COL_SPANS_KEY, JSON.stringify(spans));
      });

      // Prevent drag when horizontally resizing
      this.element.addEventListener('dragstart', (e) => {
        if (this.isResizingH) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return false;
        }
      }, true);
    }
  }


  protected setDataBadge(state: 'live' | 'cached' | 'unavailable', detail?: string): void {
    if (!this.statusBadgeEl) return;
    const labels = { live: 'LIVE', cached: 'CACHED', unavailable: 'UNAVAILABLE' } as const;
    this.statusBadgeEl.textContent = detail ? `${labels[state]} · ${detail}` : labels[state];
    this.statusBadgeEl.className = `panel-data-badge ${state}`;
    this.statusBadgeEl.style.display = 'inline-flex';
  }

  protected clearDataBadge(): void {
    if (!this.statusBadgeEl) return;
    this.statusBadgeEl.style.display = 'none';
  }
  public getElement(): HTMLElement {
    return this.element;
  }

  public showLoading(message = 'Loading'): void {
    this.content.innerHTML = `
      <div class="panel-loading">
        <div class="panel-loading-radar">
          <div class="panel-radar-sweep"></div>
          <div class="panel-radar-dot"></div>
        </div>
        <div class="panel-loading-text">${escapeHtml(message)}</div>
      </div>
    `;
  }

  public showError(message = 'Failed to load data'): void {
    this.content.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
  }

  public setCount(count: number): void {
    if (this.countEl) {
      this.countEl.textContent = count.toString();
    }
  }

  public setErrorState(hasError: boolean, tooltip?: string): void {
    this.header.classList.toggle('panel-header-error', hasError);
    if (tooltip) {
      this.header.title = tooltip;
    } else {
      this.header.removeAttribute('title');
    }
  }

  public setContent(html: string): void {
    this.content.innerHTML = html;
  }

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public toggle(visible: boolean): void {
    if (visible) this.show();
    else this.hide();
  }

  /**
   * Update the "new items" badge
   * @param count Number of new items (0 hides badge)
   * @param pulse Whether to pulse the badge (for important updates)
   */
  public setNewBadge(count: number, pulse = false): void {
    if (!this.newBadgeEl) return;

    if (count <= 0) {
      this.newBadgeEl.style.display = 'none';
      this.newBadgeEl.classList.remove('pulse');
      this.element.classList.remove('has-new');
      return;
    }

    this.newBadgeEl.textContent = count > 99 ? '99+' : `${count} new`;
    this.newBadgeEl.style.display = 'inline-flex';
    this.element.classList.add('has-new');

    if (pulse) {
      this.newBadgeEl.classList.add('pulse');
    } else {
      this.newBadgeEl.classList.remove('pulse');
    }
  }

  /**
   * Clear the new items badge
   */
  public clearNewBadge(): void {
    this.setNewBadge(0);
  }

  /**
   * Get the panel ID
   */
  public getId(): string {
    return this.panelId;
  }

  /**
   * Reset panel height to default
   */
  public resetHeight(): void {
    this.element.classList.remove('resized', 'span-1', 'span-2', 'span-3', 'span-4');
    const spans = loadPanelSpans();
    delete spans[this.panelId];
    localStorage.setItem(PANEL_SPANS_KEY, JSON.stringify(spans));
  }

  /**
   * Clean up event listeners and resources
   */
  public destroy(): void {
    if (this.tooltipCloseHandler) {
      document.removeEventListener('click', this.tooltipCloseHandler);
      this.tooltipCloseHandler = null;
    }
    if (this.onTouchMove) {
      document.removeEventListener('touchmove', this.onTouchMove);
      this.onTouchMove = null;
    }
    if (this.onTouchEnd) {
      document.removeEventListener('touchend', this.onTouchEnd);
      this.onTouchEnd = null;
    }
    if (this.onDocMouseUp) {
      document.removeEventListener('mouseup', this.onDocMouseUp);
      this.onDocMouseUp = null;
    }
  }
}
