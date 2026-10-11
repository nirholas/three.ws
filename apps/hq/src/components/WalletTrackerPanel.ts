import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

const WALLETS_STORAGE_KEY = 'hq-tracked-wallets';
const MAX_TRACKED_WALLETS = 20;

interface TrackedWallet {
  address: string;
  label: string;
  chain: string;
}

interface WalletTxn {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  method: string;
  isError: boolean;
  direction: string;
}

interface WalletResult {
  address: string;
  chain: string;
  label: string;
  transactions: WalletTxn[];
  lastActive: number | null;
  error?: string;
}

const CHAINS = [
  { value: 'eth', label: 'ETH' },
  { value: 'arb', label: 'ARB' },
  { value: 'bsc', label: 'BSC' },
  { value: 'sol', label: 'SOL' },
] as const;

const VALID_CHAINS: Set<string> = new Set(CHAINS.map(c => c.value));

const EXPLORER_BASE: Record<string, string> = {
  eth: 'https://etherscan.io',
  arb: 'https://arbiscan.io',
  bsc: 'https://bscscan.com',
  sol: 'https://solscan.io',
};

/** EVM address: 0x followed by 40 hex chars. Solana: 32-44 base58 chars. */
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isValidAddress(address: string, chain: string): boolean {
  if (chain === 'sol') return SOL_ADDRESS_RE.test(address);
  return EVM_ADDRESS_RE.test(address);
}

export class WalletTrackerPanel extends Panel {
  private wallets: TrackedWallet[] = [];
  private walletData: WalletResult[] = [];
  private isLoading = false;
  private fetchController: AbortController | null = null;

  constructor() {
    super({ id: 'wallet-tracker', title: 'Wallet Tracker', className: 'wallet-tracker-panel' });
    this.loadWallets();
    this.renderTracker();
  }

  private loadWallets(): void {
    try {
      const raw = localStorage.getItem(WALLETS_STORAGE_KEY);
      if (!raw) { this.wallets = []; return; }
      const parsed = JSON.parse(raw);
      // Validate shape of stored data
      if (!Array.isArray(parsed)) { this.wallets = []; return; }
      this.wallets = parsed.filter(
        (w: unknown): w is TrackedWallet =>
          typeof w === 'object' && w !== null &&
          typeof (w as TrackedWallet).address === 'string' &&
          typeof (w as TrackedWallet).chain === 'string' &&
          VALID_CHAINS.has((w as TrackedWallet).chain) &&
          isValidAddress((w as TrackedWallet).address, (w as TrackedWallet).chain)
      ).slice(0, MAX_TRACKED_WALLETS);
    } catch {
      this.wallets = [];
    }
  }

  private saveWallets(): void {
    localStorage.setItem(WALLETS_STORAGE_KEY, JSON.stringify(this.wallets.slice(0, MAX_TRACKED_WALLETS)));
  }

  private renderTracker(): void {
    this.content.innerHTML = `
      <div class="wt-add-row">
        <input type="text" class="wt-addr-input" placeholder="Paste wallet address…" maxlength="64" spellcheck="false" autocomplete="off" />
        <input type="text" class="wt-label-input" placeholder="Label" maxlength="24" />
        <select class="wt-chain-select" aria-label="Blockchain network">
          ${CHAINS.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
        </select>
        <button class="wt-add-btn">Track</button>
      </div>
      ${this.wallets.length === 0 ? '<div class="wt-empty">No wallets tracked. Add an address above.</div>' : ''}
      <div class="wt-wallets-list">
        ${this.wallets.map((w, i) => this.renderWalletCard(w, i)).join('')}
      </div>
      ${this.isLoading ? '<div class="wt-loading">Loading transactions…</div>' : ''}
    `;

    // Bind add
    const addrInput = this.content.querySelector('.wt-addr-input') as HTMLInputElement;
    const labelInput = this.content.querySelector('.wt-label-input') as HTMLInputElement;
    const chainSelect = this.content.querySelector('.wt-chain-select') as HTMLSelectElement;
    const addBtn = this.content.querySelector('.wt-add-btn') as HTMLButtonElement;

    const handleAdd = (): void => {
      const addr = addrInput.value.trim();
      const chain = chainSelect.value;

      if (!addr) return;

      // Validate address format
      if (!isValidAddress(addr, chain)) {
        addrInput.classList.add('wt-input-error');
        addrInput.setAttribute('title', chain === 'sol' ? 'Invalid Solana address' : 'Invalid EVM address (0x...)');
        setTimeout(() => {
          addrInput.classList.remove('wt-input-error');
          addrInput.removeAttribute('title');
        }, 2000);
        return;
      }

      // Enforce max limit
      if (this.wallets.length >= MAX_TRACKED_WALLETS) {
        addrInput.setAttribute('title', `Maximum ${MAX_TRACKED_WALLETS} wallets`);
        setTimeout(() => addrInput.removeAttribute('title'), 2000);
        return;
      }

      const label = labelInput.value.trim().slice(0, 24) || this.shortenAddr(addr);

      // Avoid duplicates
      if (this.wallets.some(w => w.address.toLowerCase() === addr.toLowerCase() && w.chain === chain)) return;

      this.wallets.push({ address: addr, label, chain });
      this.saveWallets();
      addrInput.value = '';
      labelInput.value = '';
      this.renderTracker();
      this.update();
    };

    addBtn.addEventListener('click', handleAdd);
    addrInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd();
    });

    // Bind remove buttons
    this.content.querySelectorAll('.wt-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.idx || '0', 10);
        if (idx >= 0 && idx < this.wallets.length) {
          this.wallets.splice(idx, 1);
          this.saveWallets();
          this.renderTracker();
        }
      });
    });

    // Bind refresh
    this.content.querySelectorAll('.wt-refresh-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.update();
      });
    });

    // Delegated click handler for detail:open buttons
    this.content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.detail-open-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = JSON.parse(btn.getAttribute('data-detail-event') || '{}');
        window.dispatchEvent(new CustomEvent('detail:open', { detail: { type: 'event', data } }));
      } catch { /* ignore parse errors */ }
    });
  }

  private renderWalletCard(wallet: TrackedWallet, index: number): string {
    const data = this.walletData.find(
      d => d.address.toLowerCase() === wallet.address.toLowerCase() && d.chain === wallet.chain
    );
    const explorer = EXPLORER_BASE[wallet.chain] || EXPLORER_BASE.eth;
    const txUrl = wallet.chain === 'sol'
      ? `${explorer}/account/${encodeURIComponent(wallet.address)}`
      : `${explorer}/address/${encodeURIComponent(wallet.address)}`;

    return `
      <div class="wt-wallet-card">
        <div class="wt-wallet-header">
          <div class="wt-wallet-info">
            <span class="wt-chain-badge wt-chain-${escapeHtml(wallet.chain)}">${escapeHtml(wallet.chain.toUpperCase())}</span>
            <a class="wt-wallet-label" href="${escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(wallet.label)}
            </a>
            <span class="wt-wallet-addr">${escapeHtml(this.shortenAddr(wallet.address))}</span>
          </div>
          <div class="wt-wallet-actions">
            <button class="detail-open-btn" data-detail-event='${escapeHtml(JSON.stringify({ title: wallet.label, description: 'Chain: ' + wallet.chain.toUpperCase() + ' \u2022 Address: ' + wallet.address, category: 'wallet', url: txUrl }))}' style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.6" title="View details">ℹ</button>
            <button class="wt-refresh-btn" title="Refresh" aria-label="Refresh wallet data">↻</button>
            <button class="wt-remove-btn" data-idx="${index}" title="Remove" aria-label="Remove wallet">×</button>
          </div>
        </div>
        ${data ? this.renderTxns(data, wallet.chain) : '<div class="wt-no-data">Click ↻ to load</div>'}
      </div>
    `;
  }

  private renderTxns(data: WalletResult, chain: string): string {
    if (data.error) return `<div class="wt-error">${escapeHtml(data.error)}</div>`;
    if (data.transactions.length === 0) return '<div class="wt-no-data">No recent transactions</div>';

    const explorer = EXPLORER_BASE[chain] || EXPLORER_BASE.eth;
    const rows = data.transactions.slice(0, 10).map(tx => {
      const txLink = chain === 'sol'
        ? `${explorer}/tx/${encodeURIComponent(tx.hash)}`
        : `${explorer}/tx/${encodeURIComponent(tx.hash)}`;
      const dir = tx.direction === 'in' ? '← IN' : tx.direction === 'out' ? '→ OUT' : '↔';
      const dirClass = tx.direction === 'in' ? 'wt-dir-in' : tx.direction === 'out' ? 'wt-dir-out' : '';
      const val = parseFloat(tx.value);
      const valStr = val > 0.0001 ? `${val > 1000 ? val.toFixed(1) : val.toFixed(4)} ${chain.toUpperCase()}` : '';
      return `
        <div class="wt-tx-row ${tx.isError ? 'wt-tx-error' : ''}">
          <span class="wt-tx-dir ${dirClass}">${dir}</span>
          <span class="wt-tx-method">${escapeHtml(tx.method || 'unknown')}</span>
          <span class="wt-tx-value">${valStr}</span>
          <span class="wt-tx-time">${this.timeAgo(tx.timestamp)}</span>
          <a class="wt-tx-link" href="${escapeHtml(txLink)}" target="_blank" rel="noopener noreferrer" aria-label="View on explorer">↗</a>
        </div>
      `;
    }).join('');

    return `<div class="wt-tx-list">${rows}</div>`;
  }

  private shortenAddr(addr: string): string {
    if (!addr || addr.length < 10) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  private timeAgo(ts: number): string {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 0) return 'now';
    if (diff < 60_000) return 'now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / 86_400_000)}d`;
  }

  public async update(): Promise<void> {
    if (this.wallets.length === 0) return;

    // Cancel any in-flight request
    this.fetchController?.abort();
    this.fetchController = new AbortController();
    const { signal } = this.fetchController;

    this.isLoading = true;
    this.renderTracker();

    // Group wallets by chain
    const byChain: Record<string, TrackedWallet[]> = {};
    for (const w of this.wallets) {
      (byChain[w.chain] ??= []).push(w);
    }

    const allResults: WalletResult[] = [];

    for (const [chain, wallets] of Object.entries(byChain)) {
      // Check if aborted before each network call
      if (signal.aborted) return;

      try {
        const addrs = wallets.map(w => w.address).join(',');
        const resp = await fetch(`/api/wallet-tracker?chain=${encodeURIComponent(chain)}&wallets=${encodeURIComponent(addrs)}`, { signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.wallets && Array.isArray(data.wallets)) {
          // Merge labels
          for (const wr of data.wallets as WalletResult[]) {
            const tracked = wallets.find(w => w.address.toLowerCase() === wr.address.toLowerCase());
            if (tracked) wr.label = tracked.label;
            allResults.push(wr);
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        wallets.forEach(w => {
          allResults.push({
            address: w.address,
            chain: w.chain,
            label: w.label,
            transactions: [],
            lastActive: null,
            error: 'Failed to fetch',
          });
        });
      }
    }

    // Only update state if we weren't aborted
    if (!signal.aborted) {
      this.walletData = allResults;
      this.isLoading = false;
      this.renderTracker();
    }
  }

  public override destroy(): void {
    this.fetchController?.abort();
    this.fetchController = null;
    super.destroy();
  }
}
