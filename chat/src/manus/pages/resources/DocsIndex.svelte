<script>
  const sections = [
    { label: 'Getting started', items: ['Quickstart', 'Installation', 'Your first agent'] },
    { label: 'Concepts', items: ['Agents', 'Tasks', 'Context', 'Memory'] },
    { label: 'API', items: ['Authentication', 'Endpoints', 'Rate limits', 'Errors'] },
    { label: 'SDKs', items: ['JavaScript', 'Python', 'Go'] },
    { label: 'Tools', items: ['Web search', 'Code execution', 'File system', 'Browser'] },
    { label: 'Skills', items: ['Built-in skills', 'Custom skills', 'Skill chaining'] },
    { label: 'Deployments', items: ['Overview', 'Cloud', 'Self-hosted'] },
    { label: 'FAQs', items: ['General', 'Billing', 'Security'] },
  ];

  let active = 'Quickstart';
</script>

<div class="max-w-[1100px] mx-auto px-6 pt-16 pb-24 flex gap-8">
  <!-- Left rail -->
  <aside class="w-[240px] shrink-0">
    <div class="sticky top-20">
      <input
        type="search"
        placeholder="Search docs"
        class="bg-white border border-[#E5E3DC] rounded-full h-9 px-3 text-sm w-full mb-6 focus:outline-none focus:border-[#1A1A1A]"
      />
      {#each sections as s}
        <div class="mb-4">
          <div class="text-xs font-semibold uppercase tracking-wide text-[#9C9A93] mb-1">{s.label}</div>
          <ul class="space-y-0.5">
            {#each s.items as item}
              <li>
                <button
                  class="w-full text-left text-sm px-2 py-1 rounded-lg transition-colors {active === item ? 'bg-[#F5F4EF] text-[#1A1A1A] font-medium' : 'text-[#6B6B6B] hover:text-[#1A1A1A] hover:bg-[#F5F4EF]'}"
                  on:click={() => active = item}
                >{item}</button>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </aside>

  <!-- Content -->
  <main class="flex-1 min-w-0 prose prose-neutral max-w-none">
    <h1>Welcome to Manus Docs</h1>
    <p>
      Manus is an agent-first platform for building, running, and deploying AI agents. This documentation covers everything from your first agent run to production deployments.
    </p>

    <h2>What is Manus?</h2>
    <p>
      Manus gives you a powerful runtime for multi-step AI tasks. Agents can browse the web, write and run code, manage files, and call external APIs — all orchestrated through a simple chat interface or programmatic API.
    </p>

    <h2>Getting started</h2>
    <p>The fastest way to get started is with the quickstart guide:</p>
    <ol>
      <li>Create a free account at <code>manus.ai</code></li>
      <li>Pick a model from the model selector</li>
      <li>Type your first task in the composer</li>
    </ol>

    <h2>Core concepts</h2>
    <p>
      <strong>Agents</strong> are stateful processes that carry out multi-step tasks on your behalf.
      Each agent has access to a configurable set of <strong>tools</strong> — web search, code execution, the file system, and more.
    </p>
    <p>
      <strong>Skills</strong> are reusable agent capabilities you can share across projects. You can author custom skills or use the built-in library.
    </p>

    <h2>Need help?</h2>
    <p>
      Open an issue on GitHub, reach the team via the in-app chat, or join the community Discord.
    </p>
  </main>
</div>
