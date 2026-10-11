/**
 * NotificationCenter - persistent bell/notification area
 *
 * Surfaces signals and alerts from the signal aggregation system
 * (geo convergence, temporal anomalies, country instability, market extremes).
 *
 * Bell icon in header with unread badge. Click opens a slide-out panel
 * with filterable, priority-colored notification list.
 */

export type NotificationType = 'convergence' | 'anomaly' | 'instability' | 'market' | 'info';
export type NotificationPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: Date;
  read: boolean;
  priority: NotificationPriority;
  country?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const MAX_NOTIFICATIONS = 50;
const STORAGE_KEY = 'hq-notifications';
const SEEN_KEY_TTL_MS = 30 * 60 * 1000; // 30 minutes dedup window

const TYPE_ICONS: Record<NotificationType, string> = {
  convergence: '🎯',
  anomaly: '⚡',
  instability: '🔺',
  market: '📊',
  info: 'ℹ️',
};

const PRIORITY_COLORS: Record<NotificationPriority, string> = {
  critical: '#ff4444',
  high: '#ff8c00',
  medium: '#4a9eff',
  low: '#666',
};

interface StoredNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: string; // ISO
  read: boolean;
  priority: NotificationPriority;
  country?: string;
  actionLabel?: string;
}

export class NotificationCenter {
  private notifications: Notification[] = [];
  private seenKeys = new Map<string, number>(); // dedup key → timestamp
  private panelEl: HTMLElement;
  private listEl: HTMLElement;
  private badgeEl: HTMLElement | null = null;
  private isOpen = false;
  private audioCtx: AudioContext | null = null;
  private soundEnabled = true;
  private onFlyToCountry: ((code: string) => void) | null = null;

  constructor() {
    // Load persisted notifications
    this.loadFromStorage();

    // Build slide-out panel (appended to body)
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'notif-panel';
    this.panelEl.innerHTML = `
      <div class="notif-panel-header">
        <span class="notif-panel-title">🔔 Notifications</span>
        <div class="notif-panel-actions">
          <button class="notif-action-btn notif-mark-all-btn" title="Mark all read">✓ All</button>
          <button class="notif-action-btn notif-clear-btn" title="Clear all">🗑 Clear</button>
          <button class="notif-action-btn notif-sound-btn" title="Toggle sound">🔊</button>
          <button class="notif-action-btn notif-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div class="notif-panel-list"></div>
      <div class="notif-panel-empty">No notifications yet</div>
    `;
    document.body.appendChild(this.panelEl);

    this.listEl = this.panelEl.querySelector('.notif-panel-list') as HTMLElement;

    // Wire panel header actions
    this.panelEl.querySelector('.notif-mark-all-btn')!.addEventListener('click', () => this.markAllRead());
    this.panelEl.querySelector('.notif-clear-btn')!.addEventListener('click', () => this.clearAll());
    this.panelEl.querySelector('.notif-close-btn')!.addEventListener('click', () => this.close());
    this.panelEl.querySelector('.notif-sound-btn')!.addEventListener('click', (e) => {
      this.soundEnabled = !this.soundEnabled;
      (e.currentTarget as HTMLElement).textContent = this.soundEnabled ? '🔊' : '🔇';
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!this.isOpen) return;
      const target = e.target as HTMLElement;
      if (!this.panelEl.contains(target) && !target.closest('.notif-bell-btn')) {
        this.close();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    this.render();
  }

  /** Set the handler that flies the map to a country code */
  public setFlyToHandler(handler: (code: string) => void): void {
    this.onFlyToCountry = handler;
  }

  /** Attach bell button behavior - call after header is rendered */
  public attachBellButton(): void {
    const btn = document.getElementById('notifBellBtn');
    if (!btn) return;
    this.badgeEl = btn.querySelector('.notif-badge') as HTMLElement;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.updateBadge();
  }

  /** Push a notification (with dedup check) */
  public push(notif: Omit<Notification, 'id' | 'timestamp' | 'read'>): void {
    // Build dedup key from type + title (or country)
    const dedupKey = `${notif.type}:${notif.title}:${notif.country ?? ''}`;
    const now = Date.now();

    // Check if same notification was pushed within the dedup window
    const lastSeen = this.seenKeys.get(dedupKey);
    if (lastSeen && now - lastSeen < SEEN_KEY_TTL_MS) return;
    this.seenKeys.set(dedupKey, now);

    // Prune old dedup keys
    if (this.seenKeys.size > 200) {
      for (const [key, ts] of this.seenKeys) {
        if (now - ts > SEEN_KEY_TTL_MS) this.seenKeys.delete(key);
      }
    }

    const notification: Notification = {
      ...notif,
      id: `notif-${now}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
      read: false,
    };

    this.notifications.unshift(notification);

    // Prune to max
    if (this.notifications.length > MAX_NOTIFICATIONS) {
      this.notifications = this.notifications.slice(0, MAX_NOTIFICATIONS);
    }

    this.saveToStorage();
    this.updateBadge();

    // Play notification sound if enabled
    if (this.soundEnabled && (notif.priority === 'critical' || notif.priority === 'high')) {
      this.playNotificationSound(notif.priority);
    }

    // Re-render list if panel is open
    if (this.isOpen) this.renderList();
  }

  /** Get unread count */
  public getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  public open(): void {
    this.isOpen = true;
    this.panelEl.classList.add('notif-panel-open');
    this.renderList();
  }

  public close(): void {
    this.isOpen = false;
    this.panelEl.classList.remove('notif-panel-open');
  }

  public destroy(): void {
    this.panelEl.remove();
  }

  // ── Private ───────────────────────────────────────────────

  private markAllRead(): void {
    for (const n of this.notifications) n.read = true;
    this.saveToStorage();
    this.updateBadge();
    this.renderList();
  }

  private clearAll(): void {
    this.notifications = [];
    this.saveToStorage();
    this.updateBadge();
    this.renderList();
  }

  private markRead(id: string): void {
    const n = this.notifications.find(x => x.id === id);
    if (n) {
      n.read = true;
      this.saveToStorage();
      this.updateBadge();
    }
  }

  private updateBadge(): void {
    const unread = this.getUnreadCount();
    if (this.badgeEl) {
      this.badgeEl.textContent = unread > 99 ? '99+' : String(unread);
      this.badgeEl.style.display = unread > 0 ? 'flex' : 'none';
    }
  }

  private render(): void {
    this.updateBadge();
    if (this.isOpen) this.renderList();
  }

  private renderList(): void {
    const emptyEl = this.panelEl.querySelector('.notif-panel-empty') as HTMLElement;

    if (this.notifications.length === 0) {
      this.listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    this.listEl.innerHTML = '';

    for (const notif of this.notifications) {
      const item = document.createElement('div');
      item.className = `notif-item${notif.read ? '' : ' notif-unread'}`;
      item.style.borderLeftColor = PRIORITY_COLORS[notif.priority];

      const icon = TYPE_ICONS[notif.type] ?? 'ℹ️';
      const timeAgo = this.formatTimeAgo(notif.timestamp);

      item.innerHTML = `
        <div class="notif-item-icon">${icon}</div>
        <div class="notif-item-content">
          <div class="notif-item-header">
            <span class="notif-item-title">${this.escapeHtml(notif.title)}</span>
            <span class="notif-item-time">${timeAgo}</span>
          </div>
          <div class="notif-item-body">${this.escapeHtml(notif.body)}</div>
          ${notif.actionLabel ? `<button class="notif-item-action">${this.escapeHtml(notif.actionLabel)}</button>` : ''}
        </div>
        <button class="notif-item-dismiss" title="Dismiss">×</button>
      `;

      // Click item → mark read
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.notif-item-dismiss') ||
            (e.target as HTMLElement).closest('.notif-item-action')) return;
        this.markRead(notif.id);
        item.classList.remove('notif-unread');
      });

      // Action button
      const actionBtn = item.querySelector('.notif-item-action');
      if (actionBtn && notif.onAction) {
        const action = notif.onAction;
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.markRead(notif.id);
          item.classList.remove('notif-unread');
          action();
        });
      } else if (actionBtn && notif.country && this.onFlyToCountry) {
        // Default action: fly to country
        const code = notif.country;
        const handler = this.onFlyToCountry;
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.markRead(notif.id);
          item.classList.remove('notif-unread');
          handler(code);
        });
      }

      // Dismiss button
      item.querySelector('.notif-item-dismiss')!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.notifications = this.notifications.filter(n => n.id !== notif.id);
        this.saveToStorage();
        this.updateBadge();
        item.remove();
        if (this.notifications.length === 0) {
          (this.panelEl.querySelector('.notif-panel-empty') as HTMLElement).style.display = 'block';
        }
      });

      this.listEl.appendChild(item);
    }
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  private playNotificationSound(priority: NotificationPriority): void {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      const ctx = this.audioCtx;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      if (priority === 'critical') {
        // Two-tone alert
        oscillator.frequency.setValueAtTime(880, ctx.currentTime);
        oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.3);
      } else {
        // Single subtle beep
        oscillator.frequency.setValueAtTime(660, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.15);
      }
    } catch {
      // Audio not available, silently ignore
    }
  }

  private saveToStorage(): void {
    try {
      const data: StoredNotification[] = this.notifications.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        timestamp: n.timestamp.toISOString(),
        read: n.read,
        priority: n.priority,
        country: n.country,
        actionLabel: n.actionLabel,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or unavailable
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data: StoredNotification[] = JSON.parse(raw);
      this.notifications = data.slice(0, MAX_NOTIFICATIONS).map(n => ({
        ...n,
        timestamp: new Date(n.timestamp),
        onAction: undefined,
      }));
    } catch {
      // Corrupted data - ignore
    }
  }
}
