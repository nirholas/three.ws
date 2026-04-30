<script>
	import { createEventDispatcher, tick } from 'svelte';
	import { v4 as uuidv4 } from 'uuid';
	import {
		anthropicAPIKey,
		config,
		getAPIKeysAsObject,
		groqAPIKey,
		mistralAPIKey,
		openaiAPIKey,
		openrouterAPIKey,
		params,
		remoteServer,
		syncServer,
		toolSchema,
	} from './stores.js';
	import Button from './Button.svelte';
	import Modal from './Modal.svelte';
	import Icon from './Icon.svelte';
	import {
		feEdit3,
		feHardDrive,
		feKey,
		feLayout,
		feStar,
		feRefreshCw,
		feTool,
		feUsers,
		feX,
	} from './feather.js';
	import { brandConfig } from './stores.js';
	import { BUILTIN_MODELS } from './providers.js';
	import ClientToolSetting from './ClientToolSetting.svelte';
	import ClientTool from './ClientTool.svelte';
	import Tooltip from './Tooltip.svelte';
	import ModelSelector from './ModelSelector.svelte';
	import { sendSingleItem } from './sync.js';

	const dispatch = createEventDispatcher();

	export let open = false;
	export let trigger = '';

	let activeTab = 'api-keys';

	// Brand admin panel
	let adminKey = '';
	let adminUnlocked = false;
	let brandSaving = false;
	let brandSaveError = '';
	let brandSaveOk = false;
	let brandDraft = { name: '', logo_url: '', accent_color: '#6366f1', tagline: '', system_prompt: '' };

	function openBrandTab() {
		activeTab = 'brand';
		brandDraft = {
			name: $brandConfig.name,
			logo_url: $brandConfig.logo_url ?? '',
			accent_color: $brandConfig.accent_color,
			tagline: $brandConfig.tagline,
			default_model: $brandConfig.default_model,
			agent_id: $brandConfig.agent_id ?? '',
			system_prompt: $brandConfig.system_prompt ?? '',
		};
	}

	async function saveBrand() {
		brandSaving = true;
		brandSaveError = '';
		brandSaveOk = false;
		try {
			const res = await fetch('/api/chat/config', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
				body: JSON.stringify({
					...brandDraft,
					logo_url: brandDraft.logo_url || null,
					agent_id: brandDraft.agent_id || null,
					system_prompt: brandDraft.system_prompt || undefined,
				}),
			});
			const json = await res.json();
			if (!res.ok) {
				brandSaveError = json.error_description ?? 'Save failed';
			} else {
				brandConfig.set(json.data);
				brandSaveOk = true;
				setTimeout(() => (brandSaveOk = false), 3000);
			}
		} catch {
			brandSaveError = 'Network error';
		} finally {
			brandSaving = false;
		}
	}

	let addClientToolOpen = false;
	let loadClientTool = null;

	let elRefreshToolSchema;

	async function onAPIKeyUpdate() {
		dispatch('fetchModels');
		if ($syncServer.token && $syncServer.password) {
			await sendSingleItem($syncServer.address, $syncServer.token, {
				conversation: null,
				message: null,
				apiKeys: getAPIKeysAsObject(),
			});
		}
	}
</script>

<Modal bind:open {trigger}>
	<div class="flex flex-col gap-x-8 gap-y-4 sm:flex-row">
		<div class="flex flex-col">
			<h1 class="mb-4 ml-3 text-xl font-semibold sm:mb-5">Settings</h1>

			<nav class="sm:w-[190px]">
				<ul class="flex flex-col gap-1">
					<li>
						<button
							class="{activeTab === 'api-keys'
								? 'bg-gray-100/70'
								: 'hover:bg-gray-100/70'} flex w-full items-center gap-x-2.5 rounded-lg px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors"
							on:click={() => (activeTab = 'api-keys')}
						>
							<Icon icon={feKey} class="h-3 w-3 text-slate-700" />
							API keys
						</button>
					</li>
					<li>
						<button
							class="{activeTab === 'custom-instructions'
								? 'bg-gray-100/70'
								: 'hover:bg-gray-100/70'} flex w-full items-center gap-x-2.5 rounded-lg px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors"
							on:click={() => (activeTab = 'custom-instructions')}
						>
							<Icon icon={feEdit3} class="h-3 w-3 text-slate-700" />
							Custom instructions
						</button>
					</li>
					<li>
						<button
							class="{activeTab === 'remote-server'
								? 'bg-gray-100/70'
								: ' hover:bg-gray-100/70'} flex w-full items-center gap-x-2.5 rounded-lg px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors"
							on:click={() => (activeTab = 'remote-server')}
						>
							<Icon icon={feHardDrive} class="h-3 w-3 text-slate-700" />
							Sync and servers
						</button>
					</li>
					<li>
						<button
							class="{activeTab === 'tools'
								? 'bg-gray-100/70'
								: ' hover:bg-gray-100/70'} flex w-full items-center gap-x-2.5 rounded-lg px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors"
							on:click={() => (activeTab = 'tools')}
						>
							<Icon icon={feTool} class="h-3 w-3 text-slate-700" />
							Tool calling
						</button>
					</li>
					<li>
						<button
							class="{activeTab === 'brand'
								? 'bg-gray-100/70'
								: ' hover:bg-gray-100/70'} flex w-full items-center gap-x-2.5 rounded-lg px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors"
							on:click={openBrandTab}
						>
							<Icon icon={feLayout} class="h-3 w-3 text-slate-700" />
							Brand
						</button>
					</li>
					<!--					TODO: Consensus-->
					<!--					<li>-->
					<!--						<button-->
					<!--							class="{activeTab === 'consensus'-->
					<!--								? 'bg-gray-100/70'-->
					<!--								: ' hover:bg-gray-100/70'} flex w-full items-center gap-x-2.5 rounded-lg px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors"-->
					<!--							on:click={() => (activeTab = 'consensus')}-->
					<!--						>-->
					<!--							<Icon icon={feUsers} class="h-3 w-3 text-slate-700" />-->
					<!--							Consensus mode-->
					<!--						</button>-->
					<!--					</li>-->
				</ul>
			</nav>
		</div>
		<div class="flex flex-col gap-y-4 pt-1 sm:w-[400px]">
			{#if activeTab === 'api-keys'}
				<label class="flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 ml-[3px]">OpenRouter API Key</span>
					<input
						type="text"
						bind:value={$openrouterAPIKey}
						placeholder="Enter your API key"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
						on:change={onAPIKeyUpdate}
					/></label
				>
				<label class="flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 ml-[3px] flex items-center gap-2"> Anthropic API Key </span>
					<input
						type="text"
						bind:value={$anthropicAPIKey}
						placeholder="Enter your API key"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
						on:change={onAPIKeyUpdate}
					/></label
				>
				<label class="flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 ml-[3px]">OpenAI API Key</span>
					<input
						type="text"
						bind:value={$openaiAPIKey}
						placeholder="Enter your API key"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
						on:change={onAPIKeyUpdate}
					/></label
				>
				<label class="flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 ml-[3px]">Groq API Key</span>
					<input
						type="text"
						bind:value={$groqAPIKey}
						placeholder="Enter your API key"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
						on:change={onAPIKeyUpdate}
					/></label
				>
				<label class="flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 ml-[3px]">Mistral API Key</span>
					<input
						type="text"
						bind:value={$mistralAPIKey}
						placeholder="Enter your API key"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
						on:change={onAPIKeyUpdate}
					/></label
				>

				<p class="ml-1 text-center text-xs leading-relaxed text-slate-800 sm:text-left">
					{#if $syncServer.token && $syncServer.password}
						Sync is enabled. Your API keys are being synced between devices. Fully end-to-end
						encrypted.
					{:else}
						Your API keys are stored entirely locally, on your device, in your browser. They are not
						sent to or stored on any remote server.
					{/if}
				</p>
			{:else if activeTab === 'custom-instructions'}
				<label class="mt-1 flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 ml-[3px]">Custom instructions</span>
					<textarea
						bind:value={$params.customInstructions}
						rows={10}
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors scrollbar-slim focus:border-slate-400 focus:outline-none"
					/></label
				>
			{:else if activeTab === 'remote-server'}
				<label class="flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 flex items-center">
						<span class="ml-[3px]">Tool server address </span>
						<Tooltip
							content="Start the three.ws chat tool server, then enter the address and passphrase here. The default address is http://localhost:8081"
							class="ml-2"
						/>
					</span>
					<input
						type="text"
						bind:value={$remoteServer.address}
						placeholder="Enter server address (default http://localhost:8081)"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
					/></label
				>

				<label class="flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 flex items-center">
						<span class="ml-[3px]">Tool server passphrase </span>
						<Tooltip
							content="If your tool server is exposed over the internet, it's a good idea to enter a passphrase. Otherwise anyone would be able to run your tools."
							class="ml-2"
						/>
					</span>
					<input
						type="text"
						bind:value={$remoteServer.password}
						placeholder="Enter tool server passphrase"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
					/></label
				>

				<label class="mt-6 flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 flex items-center">
						<span class="ml-[3px]">Sync server address </span>
						<Tooltip
							content="Run the three.ws chat sync server to sync your chats and API keys between devices. If you want to use our server instead of self-hosting leave this field as is."
							class="ml-2"
						/>
					</span>
					<input
						type="text"
						bind:value={$syncServer.address}
						placeholder="Enter sync server address, or leave as is to use ours"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
					/></label
				>

				<label class="flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 flex items-center">
						<span class="ml-[3px]">Sync server token </span>
						<Tooltip
							content="Your unique user token, used to identify your data. Copy your token and encryption password and paste them into these same fields on all the devices you want to sync with (phone, desktop, etc)."
							class="ml-2"
						/>
					</span>
					<input
						type="text"
						bind:value={$syncServer.token}
						placeholder="Enter sync token"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
					/></label
				>

				<label class="flex flex-col text-[10px] uppercase tracking-wide">
					<span class="mb-2 flex items-center">
						<span class="ml-[3px]">Sync server encryption password </span>
						<Tooltip
							content="Used to securely encrypt your data. Do NOT change your password after the initial first sync."
							class="ml-2"
						/>
					</span>
					<input
						type="text"
						bind:value={$syncServer.password}
						placeholder="Enter encryption password"
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
					/></label
				>

				{#if $syncServer.token && $syncServer.password}
					<p class="mb-4 text-xs text-slate-600">
						Sync is enabled & fully end-to-end encrypted. First sync will occur on refresh.
					</p>
				{:else}
					<p class="mb-4 text-xs text-slate-600">
						Sync is NOT enabled. You'll need to have both a token and password to enable sync.
					</p>
				{/if}

				<p class="mt-auto text-xs text-slate-600">Version: {import.meta.env.BUILD_TIMESTAMP}</p>
			{:else if activeTab === 'tools'}
				{@const toolSchemaFlat = $toolSchema.map((g) => g.schema).flat()}
				<div class="mt-1 flex flex-col">
					<span class="mb-3 ml-[3px] flex items-center text-[10px] uppercase tracking-wide">
						Tool schema
						<Tooltip
							content="If you want to use tools, you will need to have the
							three.ws chat tool server running on your machine. See the 'Sync and servers' tab for more information."
							class="ml-2"
						/>
					</span>
					<p class="ml-[3px] text-sm text-slate-700">
						{toolSchemaFlat.length}
						{toolSchemaFlat.length === 1 ? 'tool' : 'tools'} defined
					</p>
					<textarea
						rows={4}
						readonly
						class="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors scrollbar-ultraslim placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
						value={JSON.stringify($toolSchema, null, 2)}
					/>
					<div class="mt-3 flex flex-col gap-3 text-sm sm:flex-row">
						<Button
							bind:el={elRefreshToolSchema}
							variant="outline"
							class="self-start"
							on:click={async () => {
								try {
									const schema = await (
										await fetch(`${$remoteServer.address}/tool_schema`, {
											method: 'GET',
											headers: {
												Authorization: `Basic ${$remoteServer.password}`,
											},
										})
									).text();
									const clientToolsSchema = $toolSchema.find((g) => g.name === 'Client-side');
									$toolSchema = JSON.parse(schema).concat(
										clientToolsSchema ? clientToolsSchema : []
									);
									elRefreshToolSchema.dispatchEvent(new CustomEvent('flashSuccess'));
								} catch (e) {
									elRefreshToolSchema.dispatchEvent(new CustomEvent('flashError'));
									console.error(e);
								}
							}}
						>
							<Icon icon={feRefreshCw} class="mr-2 h-3 w-3 text-slate-700" />
							Sync tools from server
						</Button>
						{#if $toolSchema.length > 0}
							<Button
								variant="outline"
								class="self-start"
								on:click={() => {
									const clientToolsSchemaIndex = $toolSchema.findIndex(
										(g) => g.name === 'Client-side'
									);
									$toolSchema = $toolSchema.filter((_g, i) => i === clientToolsSchemaIndex);
								}}
							>
								<Icon icon={feX} class="mr-2 h-3 w-3 text-slate-700" />
								Clear server tools
							</Button>
						{/if}
					</div>
				</div>

				<div>
					<p class="mt-1 flex flex-col text-[10px] uppercase tracking-wide">
						<span class="ml-[3px] flex items-center">
							Client-side tools
							<Tooltip
								content="Allows you to define custom tools that run directly in your browser (JavaScript only)."
								class="ml-2"
							/>
						</span>
					</p>
					<div class="mt-3 flex flex-col gap-y-3">
						{#each $toolSchema
							.find((g) => g.name === 'Client-side')
							?.schema.filter((t) => t.clientDefinition) || [] as tool}
							<ClientTool
								definition={tool.clientDefinition}
								on:edit={async () => {
									addClientToolOpen = true;
									await tick();
									loadClientTool(tool.clientDefinition);
								}}
								on:delete={() => {
									dispatch('disableTool', tool.clientDefinition.name);
									const clientToolsSchemaIndex = $toolSchema.findIndex(
										(g) => g.name === 'Client-side'
									);
									$toolSchema[clientToolsSchemaIndex].schema = $toolSchema[
										clientToolsSchemaIndex
									].schema.filter(
										(t) => t.clientDefinition && t.clientDefinition.id !== tool.clientDefinition.id
									);

									if ($toolSchema[clientToolsSchemaIndex].schema.length === 0) {
										$toolSchema = $toolSchema.filter((g) => g.name !== 'Client-side');
									}
								}}
							/>
						{/each}
						<Button
							class="self-start"
							on:click={async () => {
								addClientToolOpen = true;
								await tick();

								loadClientTool({
									name: '',
									description: '',
									arguments: [
										{
											name: '',
											type: 'string',
											description: '',
										},
									],
									body: '',
								});
							}}
						>
							<Icon icon={feStar} strokeWidth={3} class="mr-2 h-3 w-3 text-slate-700" />
							Add new tool
						</Button>
					</div>
				</div>

				<div class="mt-3">
					<label class="inline-flex cursor-pointer items-center">
						<input type="checkbox" bind:checked={$config.explicitToolView} class="peer sr-only" />
						<div
							class="peer relative h-5 w-[37px] rounded-full bg-gray-300 after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-slate-900 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none rtl:peer-checked:after:-translate-x-full"
						></div>
						<span class="ms-3 text-sm text-slate-700">Use explicit view for tool calls</span>
					</label>
				</div>
				{:else if activeTab === 'brand'}
				<div class="flex flex-col gap-y-4">
					{#if !adminUnlocked}
						<p class="text-[13px] text-slate-500">Enter your admin key to edit branding.</p>
						<label class="flex flex-col text-[10px] uppercase tracking-wide">
							<span class="mb-2 ml-[3px]">Admin key</span>
							<div class="flex gap-2">
								<input
									type="password"
									bind:value={adminKey}
									class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-indigo-400"
									placeholder="••••••••"
								/>
								<button
									class="rounded-lg bg-indigo-500 px-3 py-2 text-[13px] font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
									on:click={() => { if (adminKey.trim()) adminUnlocked = true; }}
								>Unlock</button>
							</div>
						</label>
					{:else}
						<label class="flex flex-col text-[10px] uppercase tracking-wide">
							<span class="mb-2 ml-[3px]">App name</span>
							<input
								type="text"
								bind:value={brandDraft.name}
								maxlength="100"
								class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-indigo-400"
							/>
						</label>
						<label class="flex flex-col text-[10px] uppercase tracking-wide">
							<span class="mb-2 ml-[3px]">Tagline</span>
							<input
								type="text"
								bind:value={brandDraft.tagline}
								maxlength="200"
								class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-indigo-400"
							/>
						</label>
						<label class="flex flex-col text-[10px] uppercase tracking-wide">
							<span class="mb-2 ml-[3px]">Logo URL</span>
							<input
								type="url"
								bind:value={brandDraft.logo_url}
								class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-indigo-400"
								placeholder="https://..."
							/>
						</label>
						<label class="flex flex-col text-[10px] uppercase tracking-wide">
							<span class="mb-2 ml-[3px]">Default model</span>
							<select
								bind:value={brandDraft.default_model}
								class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-indigo-400"
							>
								{#each BUILTIN_MODELS as m}
									<option value={m.id}>{m.name}</option>
								{/each}
							</select>
						</label>
						<label class="flex flex-col text-[10px] uppercase tracking-wide">
							<span class="mb-2 ml-[3px]">Floating agent ID</span>
							<input
								type="text"
								bind:value={brandDraft.agent_id}
								class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-indigo-400"
								placeholder="e.g. agent-abc123 (leave blank to hide)"
							/>
						</label>
						<label class="flex flex-col text-[10px] uppercase tracking-wide">
							<span class="mb-2 ml-[3px]">Accent color</span>
							<div class="flex items-center gap-3">
								<input type="color" bind:value={brandDraft.accent_color} class="h-9 w-10 cursor-pointer rounded border border-gray-200 p-0.5" />
								<span class="font-mono text-[12px] text-slate-500">{brandDraft.accent_color}</span>
							</div>
						</label>
						<label class="flex flex-col text-[10px] uppercase tracking-wide">
							<span class="mb-2 ml-[3px]">System prompt</span>
							<textarea
								bind:value={brandDraft.system_prompt}
								rows="8"
								class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-indigo-400 resize-y"
								placeholder="Default AI persona and instructions for all users…"
							></textarea>
							<span class="mt-1 ml-[3px] text-[10px] text-slate-400 normal-case">Users can override this with their own Custom instructions in settings.</span>
						</label>
						{#if brandSaveError}
							<p class="text-[12px] text-red-500">{brandSaveError}</p>
						{/if}
						{#if brandSaveOk}
							<p class="text-[12px] text-green-600">Saved — all users will see the updated branding.</p>
						{/if}
						<button
							class="mt-1 rounded-lg bg-indigo-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
							disabled={brandSaving}
							on:click={saveBrand}
						>{brandSaving ? 'Saving…' : 'Save branding'}</button>
					{/if}
				</div>
				<!--				TODO: Consensus-->
				<!--{:else if activeTab === 'consensus'}-->
				<!--	<div class="mt-1 flex flex-col">-->
				<!--		<span class="mb-3 ml-[3px] flex items-center text-[10px] uppercase tracking-wide">-->
				<!--			Consensus summary model-->
				<!--			<Tooltip class="ml-2">-->
				<!--				Model that summarizes outputs from the different models to gather consensus-->
				<!--			</Tooltip>-->
				<!--		</span>-->

				<!--		<ModelSelector />-->
				<!--	</div>-->
			{/if}
		</div>
	</div>
</Modal>

<Modal bind:open={addClientToolOpen} class="!px-8 transition-[all] md:!w-[800px]">
	<ClientToolSetting
		bind:load={loadClientTool}
		on:save={({ detail }) => {
			let clientToolsSchemaIndex = $toolSchema.findIndex((g) => g.name === 'Client-side');
			if (clientToolsSchemaIndex === -1) {
				$toolSchema.push({
					name: 'Client-side',
					schema: [],
				});
				$toolSchema = $toolSchema;
				clientToolsSchemaIndex = $toolSchema.length - 1;
			}
			const i = $toolSchema[clientToolsSchemaIndex].schema.findIndex(
				(tool) => tool.clientDefinition && tool.clientDefinition.id === detail.clientDefinition.id
			);
			if (i > -1) {
				$toolSchema[clientToolsSchemaIndex].schema[i] = detail;
			} else {
				$toolSchema[clientToolsSchemaIndex].schema = [
					...$toolSchema[clientToolsSchemaIndex].schema,
					{ ...detail, clientDefinition: { id: uuidv4(), ...detail.clientDefinition } },
				];
			}
			addClientToolOpen = false;
		}}
	/>
</Modal>
