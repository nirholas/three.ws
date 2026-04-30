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
{/if}
