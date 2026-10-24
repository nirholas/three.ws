<script>
  import Icon from '../Icon.svelte';
  import { mode } from '../stores.js';
  import {
    feZap, feBarChart2, feLink, feRotateCw, feCode, feCamera, feSliders,
    feBox, fePackage, feHexagon, feRepeat, feGlobe,
  } from '../feather.js';

  let { onclose } = $props();

  const items = [
    { id: 'pumpfun',    label: 'Pump.fun live feed',   icon: feZap },
    { id: 'curve',      label: 'Bonding curve',         icon: feBarChart2 },
    { id: 'wallet',     label: 'Connect wallet',        icon: feLink },
    { id: 'whale',      label: 'Wallet tracker',        icon: feCamera },
    { id: 'mascot',     label: 'Build token mascot',    icon: feRotateCw },
    { id: 'embed',      label: 'Embed on token site',   icon: feCode },
    { id: 'emotions',   label: 'Mascot emotions',       icon: feSliders },
    { id: 'ticker3d',   label: '3D token ticker',       icon: feHexagon },
    { id: 'nft3d',      label: 'NFT 3D viewer',         icon: fePackage },
    { id: 'walletview', label: 'Wallet 3D viz',         icon: feGlobe },
    { id: 'txexplain',  label: 'Explain a transaction', icon: feRepeat },
    { id: 'mintnft',    label: 'Mint scene as NFT',     icon: feBox },
  ];

  function pick(item) {
    mode.set(item.id);
    onclose?.();
  }

  function onKey(e) {
    if (e.key === 'Escape') onclose?.();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- Dismiss backdrop -->
<button
  class="fixed inset-0 z-20 cursor-default"
  aria-hidden="true"
  tabindex="-1"
  onclick={() => onclose?.()}
></button>

<!-- Dropdown card -->
<div class="absolute bottom-full mb-2 right-0 z-30 bg-white border border-rule rounded-2xl shadow-pop p-2 w-[260px]">
  {#each items as item}
    <button
      class="flex items-center gap-3 w-full px-3 h-10 rounded-lg text-sm font-medium text-ink hover:bg-paper"
      onclick={() => pick(item)}
    >
      <Icon icon={item.icon} class="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </button>
  {/each}
</div>
