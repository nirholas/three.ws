<script>
  import { mode } from '../../stores.js';
  import SamplePromptGrid from './SamplePromptGrid.svelte';
  import {
    schedulePrompts,
    researchPrompts,
    spreadsheetPrompts,
    visualizationPrompts,
    videoPrompts,
    audioPrompts,
    playbookPrompts,
    gemsPrompts,
    trackPrompts,
    portfolioPrompts,
    rugcheckPrompts,
    chart3dPrompts,
    scene3dPrompts,
    ticker3dPrompts,
    nft3dPrompts,
    walletviewPrompts,
    txexplainPrompts,
    mintnftPrompts,
  } from './utilityFlowData.js';
</script>

{#if $mode === 'schedule'}
  <SamplePromptGrid title="Schedule examples" prompts={schedulePrompts} />
{:else if $mode === 'research'}
  <SamplePromptGrid title="Research examples" prompts={researchPrompts} />
{:else if $mode === 'spreadsheet'}
  <SamplePromptGrid title="Spreadsheet templates" prompts={spreadsheetPrompts} />
{:else if $mode === 'visualization'}
  <SamplePromptGrid title="Visualization examples" prompts={visualizationPrompts} />
{:else if $mode === 'video'}
  <SamplePromptGrid title="Video examples" prompts={videoPrompts} />
{:else if $mode === 'audio'}
  <SamplePromptGrid title="Audio examples" prompts={audioPrompts} />
{:else if $mode === 'chat'}
  <p class="text-xs text-[#6B6B6B] mt-4 text-center">
    Tools and agents are off. Plain chat with the model.
  </p>
{:else if $mode === 'playbook'}
  <SamplePromptGrid title="Playbook examples" prompts={playbookPrompts} />
{:else if $mode === 'gems'}
  <SamplePromptGrid title="Find new gems" prompts={gemsPrompts} />
{:else if $mode === 'track'}
  <SamplePromptGrid title="Track a token" prompts={trackPrompts} />
{:else if $mode === 'portfolio'}
  <SamplePromptGrid title="Portfolio examples" prompts={portfolioPrompts} />
{:else if $mode === 'rugcheck'}
  <SamplePromptGrid title="Rug check examples" prompts={rugcheckPrompts} />
{:else if $mode === 'chart3d'}
  <SamplePromptGrid title="3D chart examples" prompts={chart3dPrompts} />
{:else if $mode === 'scene3d'}
  <SamplePromptGrid title="3D scene examples" prompts={scene3dPrompts} />
{:else if $mode === 'ticker3d'}
  <SamplePromptGrid title="3D token ticker" prompts={ticker3dPrompts} />
{:else if $mode === 'nft3d'}
  <SamplePromptGrid title="NFT 3D viewer" prompts={nft3dPrompts} />
{:else if $mode === 'walletview'}
  <SamplePromptGrid title="Wallet 3D viz" prompts={walletviewPrompts} />
{:else if $mode === 'txexplain'}
  <SamplePromptGrid title="Explain a transaction" prompts={txexplainPrompts} />
{:else if $mode === 'mintnft'}
  <SamplePromptGrid title="Mint scene as NFT" prompts={mintnftPrompts} />
{/if}
