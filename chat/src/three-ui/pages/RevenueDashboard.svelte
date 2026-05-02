<script>
  import { onMount } from 'svelte';
  import { route } from '../../stores.js';

  // --- state ---
  let revenueData = null;
  let wallets = [];
  let withdrawals = [];
  let withdrawalsTotal = 0;
  let loading = true;
  let loadError = '';

  // Available balance = net earned minus pending/processing withdrawals
  let availableBalance = 0;
  let currencyMint = null;
  let chain = null;

  // Form
  let amountDisplay = ''; // what user types (in USDC)
  let selectedWalletId = '';
  let submitting = false;
  let submitError = '';
  let submitSuccess = '';

  // History pagination
  let histOffset = 0;
  const HIST_LIMIT = 20;

  function formatUSDC(lamports) {
    return (lamports / 1_000_000).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' USDC';
  }

  function truncateAddr(addr) {
    if (!addr || addr.length <= 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function explorerUrl(w) {
    if (!w.tx_signature) return null;
    if (w.chain === 'solana') return `https://solscan.io/tx/${w.tx_signature}`;
    return `https://basescan.org/tx/${w.tx_signature}`;
  }

  const STATUS_LABEL = { pending: 'Queued', processing: 'Processing', completed: 'Sent', failed: 'Failed' };
  const STATUS_CLASS = {
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  async function loadAll() {
    loading = true;
    loadError = '';
    try {
      const [revRes, walletsRes, histRes] = await Promise.all([
        fetch('/api/billing/revenue', { credentials: 'include' }),
        fetch('/api/billing/payout-wallets', { credentials: 'include' }),
        fetch(`/api/billing/withdrawals?limit=${HIST_LIMIT}&offset=${histOffset}`, { credentials: 'include' }),
      ]);

      if (!revRes.ok) throw new Error('Failed to load revenue');
      if (!walletsRes.ok) throw new Error('Failed to load payout wallets');
      if (!histRes.ok) throw new Error('Failed to load withdrawal history');

      revenueData = await revRes.json();
      const walletsJson = await walletsRes.json();
      const histJson = await histRes.json();

      wallets = walletsJson.wallets ?? [];
      withdrawals = histJson.withdrawals ?? [];
      withdrawalsTotal = histJson.total ?? 0;

      // Compute available balance
      const netEarned = revenueData.summary?.net_total ?? 0;
      currencyMint = revenueData.summary?.currency_mint ?? null;
      chain = revenueData.summary?.chain ?? null;

      // Sum pending/processing withdrawals
      const inFlight = withdrawals
        .filter(w => w.status === 'pending' || w.status === 'processing')
        .reduce((s, w) => s + Number(w.amount), 0);

      availableBalance = Math.max(0, netEarned - inFlight);

      // Default wallet selection
      if (!selectedWalletId && wallets.length > 0) {
        const def = wallets.find(w => w.is_default) ?? wallets[0];
        selectedWalletId = def.id;
      }
    } catch (e) {
      loadError = e.message;
    } finally {
      loading = false;
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`/api/billing/withdrawals?limit=${HIST_LIMIT}&offset=${histOffset}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load history');
      const json = await res.json();
      withdrawals = json.withdrawals ?? [];
      withdrawalsTotal = json.total ?? 0;
    } catch (e) {
      loadError = e.message;
    }
  }

  function setMax() {
    amountDisplay = (availableBalance / 1_000_000).toFixed(6).replace(/\.?0+$/, '');
  }

  function validateAmount() {
    const v = parseFloat(amountDisplay);
    if (isNaN(v) || v <= 0) return 'Enter a valid amount';
    const lamports = Math.round(v * 1_000_000);
    if (lamports > availableBalance) return 'Insufficient balance';
    return null;
  }

  async function submit() {
    submitError = '';
    submitSuccess = '';

    const err = validateAmount();
    if (err) { submitError = err; return; }
    if (!selectedWalletId) { submitError = 'Select a payout wallet'; return; }

    const wallet = wallets.find(w => w.id === selectedWalletId);
    if (!wallet) { submitError = 'Wallet not found'; return; }

    const lamports = Math.round(parseFloat(amountDisplay) * 1_000_000);

    submitting = true;
    try {
      const res = await fetch('/api/billing/withdrawals', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: lamports,
          currency_mint: currencyMint ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          chain: wallet.chain,
          to_address: wallet.address,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        if (res.status === 422) {
          submitError = 'Insufficient balance';
        } else {
          submitError = json.error_description ?? json.error ?? 'Request failed';
        }
        return;
      }

      submitSuccess = 'Withdrawal requested. Processing typically takes 1–2 business days.';
      amountDisplay = '';
      await loadAll();
    } catch (e) {
      submitError = e.message;
    } finally {
      submitting = false;
    }
  }

  async function prevPage() {
    if (histOffset === 0) return;
    histOffset = Math.max(0, histOffset - HIST_LIMIT);
    await loadHistory();
  }

  async function nextPage() {
    if (histOffset + HIST_LIMIT >= withdrawalsTotal) return;
    histOffset += HIST_LIMIT;
    await loadHistory();
  }

  $: noWallets = wallets.length === 0;
  $: amountErr = amountDisplay ? validateAmount() : null;

  onMount(loadAll);
</script>

<section class="pt-10 pb-20 px-4 max-w-2xl mx-auto">
  <div class="flex items-center gap-3 mb-8">
    <button
      class="text-[#6B6B6B] hover:text-[#1A1A1A] text-sm"
      on:click={() => route.set('chat')}
    >← Back</button>
    <h1 class="font-serif text-2xl font-semibold text-[#1A1A1A]">Revenue &amp; Withdrawals</h1>
  </div>

  {#if loading}
    <p class="text-[#6B6B6B] text-sm">Loading…</p>
  {:else if loadError}
    <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
  {:else}

  <!-- Summary cards -->
  {#if revenueData}
  <div class="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-4">
    {#each [
      { label: 'Gross Earnings', value: revenueData.summary.gross_total },
      { label: 'Platform Fees', value: revenueData.summary.fee_total, neg: true },
      { label: 'Net Earnings', value: revenueData.summary.net_total },
      { label: 'Payments', count: revenueData.summary.payment_count },
    ] as card}
    <div class="rounded-xl border border-[#E5E3DC] bg-white p-4">
      <p class="text-xs text-[#6B6B6B] mb-1">{card.label}</p>
      {#if card.count !== undefined}
        <p class="text-lg font-semibold text-[#1A1A1A]">{card.count}</p>
      {:else}
        <p class="text-lg font-semibold {card.neg ? 'text-red-600' : 'text-[#1A1A1A]'}">
          {card.neg ? '−' : ''}{formatUSDC(card.value)}
        </p>
      {/if}
    </div>
    {/each}
  </div>
  {/if}

  <!-- Withdraw Earnings -->
  <div class="rounded-2xl border border-[#E5E3DC] bg-white p-6 mb-6">
    <h2 class="font-semibold text-[#1A1A1A] mb-4">Withdraw Earnings</h2>

    <!-- Available balance -->
    <div class="flex items-baseline gap-2 mb-5">
      <span class="text-sm text-[#6B6B6B]">Available balance</span>
      <span class="text-xl font-semibold text-[#1A1A1A]">{formatUSDC(availableBalance)}</span>
    </div>

    {#if noWallets}
      <div class="rounded-xl bg-[#F5F4EF] border border-[#E5E3DC] p-4 text-sm text-[#6B6B6B] mb-4">
        No payout wallet configured.
        <button class="text-[#1A1A1A] underline ml-1" on:click={() => route.set('settings/payout-wallets')}>
          Add a wallet
        </button>
        to enable withdrawals.
      </div>
    {/if}

    <!-- Amount -->
    <label class="block mb-4">
      <span class="text-xs font-medium text-[#6B6B6B] mb-1.5 block">Amount (USDC)</span>
      <div class="flex gap-2">
        <input
          type="number"
          min="0"
          step="0.000001"
          bind:value={amountDisplay}
          disabled={noWallets}
          placeholder="0.00"
          class="flex-1 h-11 px-4 rounded-xl border border-[#E5E3DC] bg-white focus:outline-none focus:border-[#1A1A1A] disabled:bg-[#F5F4EF] disabled:text-[#9C9A93] text-sm"
        />
        <button
          type="button"
          disabled={noWallets || availableBalance === 0}
          on:click={setMax}
          class="h-11 px-4 rounded-xl border border-[#E5E3DC] bg-white text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4EF] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >Max</button>
      </div>
      {#if amountErr}
        <p class="text-xs text-red-500 mt-1">{amountErr}</p>
      {/if}
    </label>

    <!-- Wallet selector -->
    <label class="block mb-5">
      <span class="text-xs font-medium text-[#6B6B6B] mb-1.5 block">To wallet</span>
      <div class="flex gap-2 items-center">
        {#if wallets.length > 0}
          <select
            bind:value={selectedWalletId}
            class="flex-1 h-11 px-4 rounded-xl border border-[#E5E3DC] bg-white focus:outline-none focus:border-[#1A1A1A] text-sm"
          >
            {#each wallets as w}
              <option value={w.id}>
                {w.chain.toUpperCase()} · {truncateAddr(w.address)}{w.is_default ? ' (default)' : ''}
              </option>
            {/each}
          </select>
        {:else}
          <div class="flex-1 h-11 px-4 rounded-xl border border-[#E5E3DC] bg-[#F5F4EF] flex items-center text-sm text-[#9C9A93]">
            No wallets
          </div>
        {/if}
        <button
          class="text-sm text-[#1A1A1A] underline whitespace-nowrap"
          on:click={() => route.set('settings/payout-wallets')}
        >+ Add wallet</button>
      </div>
    </label>

    <!-- Feedback messages -->
    {#if submitSuccess}
      <div class="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800 mb-4">
        {submitSuccess}
      </div>
    {/if}
    {#if submitError}
      <div class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
        {submitError}
      </div>
    {/if}

    <!-- Submit -->
    <div title={noWallets ? 'Add a payout wallet first' : ''}>
      <button
        type="button"
        disabled={noWallets || submitting || availableBalance === 0}
        on:click={submit}
        class="w-full h-11 rounded-full bg-black text-white text-sm font-medium hover:bg-[#1A1A1A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Requesting…' : 'Request Withdrawal'}
      </button>
    </div>
  </div>

  <!-- Withdrawal History -->
  <div class="rounded-2xl border border-[#E5E3DC] bg-white p-6">
    <h2 class="font-semibold text-[#1A1A1A] mb-4">Withdrawal History</h2>

    {#if withdrawals.length === 0}
      <p class="text-sm text-[#9C9A93]">No withdrawals yet.</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[#E5E3DC]">
              <th class="py-2 pr-4 text-left text-xs font-medium text-[#6B6B6B]">Date</th>
              <th class="py-2 pr-4 text-left text-xs font-medium text-[#6B6B6B]">Amount</th>
              <th class="py-2 pr-4 text-left text-xs font-medium text-[#6B6B6B]">Wallet</th>
              <th class="py-2 pr-4 text-left text-xs font-medium text-[#6B6B6B]">Status</th>
              <th class="py-2 text-left text-xs font-medium text-[#6B6B6B]">Tx</th>
            </tr>
          </thead>
          <tbody>
            {#each withdrawals as w}
              {@const txUrl = explorerUrl(w)}
              <tr class="border-b border-[#E5E3DC] last:border-0">
                <td class="py-3 pr-4 text-[#6B6B6B] whitespace-nowrap">
                  {new Date(w.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
                <td class="py-3 pr-4 font-mono text-[#1A1A1A] whitespace-nowrap">
                  {formatUSDC(w.amount)}
                </td>
                <td class="py-3 pr-4 font-mono text-[#6B6B6B] whitespace-nowrap">
                  {truncateAddr(w.to_address)}
                </td>
                <td class="py-3 pr-4">
                  <span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium {STATUS_CLASS[w.status] ?? 'bg-gray-100 text-gray-700'}">
                    {STATUS_LABEL[w.status] ?? w.status}
                  </span>
                </td>
                <td class="py-3">
                  {#if txUrl}
                    <a href={txUrl} target="_blank" rel="noopener noreferrer"
                       class="text-xs text-indigo-600 hover:underline font-mono">
                      {w.tx_signature.slice(0, 8)}…
                    </a>
                  {:else}
                    <span class="text-xs text-[#9C9A93]">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      {#if withdrawalsTotal > HIST_LIMIT}
        <div class="flex items-center justify-between mt-4 text-sm text-[#6B6B6B]">
          <span>{histOffset + 1}–{Math.min(histOffset + HIST_LIMIT, withdrawalsTotal)} of {withdrawalsTotal}</span>
          <div class="flex gap-2">
            <button
              disabled={histOffset === 0}
              on:click={prevPage}
              class="px-3 py-1 rounded-lg border border-[#E5E3DC] hover:bg-[#F5F4EF] disabled:opacity-40 disabled:cursor-not-allowed"
            >← Prev</button>
            <button
              disabled={histOffset + HIST_LIMIT >= withdrawalsTotal}
              on:click={nextPage}
              class="px-3 py-1 rounded-lg border border-[#E5E3DC] hover:bg-[#F5F4EF] disabled:opacity-40 disabled:cursor-not-allowed"
            >Next →</button>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  {/if}
</section>
