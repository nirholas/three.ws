<script>
	import { fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import {
		feArrowUp,
		fePaperclip,
		feSquare,
		feX,
		feZap,
		feUsers,
		feTool,
		feSearch,
		feFolder,
	} from './feather.js';
	import { afterUpdate, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { v4 as uuidv4 } from 'uuid';
	import { readFileAsDataURL } from './util.js';
	import { anthropicAPIKey, controller, params, remoteServer } from './stores.js';
	import ToolPill from './ToolPill.svelte';
	import ToolDropdown from './ToolDropdown.svelte';
	import ModelSelector from './ModelSelector.svelte';
	import ReasoningEffortRangeDropdown from './ReasoningEffortRangeDropdown.svelte';
	import FilesDropdown from '$src/FilesDropdown.svelte';
	import FilePill from '$src/FilePill.svelte';

	const imageUrlRegex = /https?:\/\/[^\s]+?\.(png|jpe?g)(?=\s|$)/gi;

	export let generating;
	export let convo;
	export let saveMessage;
	export let saveConversation;
	export let submitCompletion;
	export let scrollToBottom;
	export let handleAbort;
	export let tree;

	let content = '';
	let pendingImages = [];
	let imageUrlsBlacklist = [];
	let pendingFiles = [];
	let selectedFiles = [];
	$: console.log(`selectedFiles:`, selectedFiles);

	let isHoveringSend = false;
	let tokenCount = null;
	let tokenLoading = false;
	let tokenError = null;

	async function calculateTokens() {
		if (convo.models[0]?.provider !== 'Anthropic') return;

		tokenLoading = true;
		tokenError = null;

		try {
			// Build system message
			const systemMsg = convo.messages.find((m) => m.role === 'system')?.content || '';

			// Build user message content
			let fileContent = '';
			if (pendingFiles.length > 0) {
				for (const file of pendingFiles) {
					fileContent += `\`\`\`filepath="${file.path}"\n${file.contents}\n\`\`\`\n\n`;
				}
			}

			const messages = [
				...convo.messages.filter((m) => m.role !== 'system'),
				{
					role: 'user',
					content: fileContent + content,
					...(pendingImages.length > 0 && {
						content: pendingImages.map((image) => ({
							type: 'image_url',
							image_url: { url: image.url, detail: image.fidelity },
						})),
					}),
				},
			];

			const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
				method: 'POST',
				headers: {
					'x-api-key': get(anthropicAPIKey),
					'content-type': 'application/json',
					'anthropic-version': '2023-06-01',
					'anthropic-dangerous-direct-browser-access': 'true',
				},
				body: JSON.stringify({
					model: convo.models[0].id,
					system: systemMsg,
					messages,
				}),
			});

			if (!response.ok) throw new Error('Token count failed');
			const data = await response.json();
			tokenCount = data.input_tokens;
		} catch (err) {
			tokenError = err.message;
		} finally {
			tokenLoading = false;
		}
	}

	let toolsOpen = false;
	let filesOpen = false;
	let reasoningEffortDropdownOpen = false;
	let websearchEnabled = false;

	$: isMultimodal = convo.models[0].modality === 'text+image->text';

	async function sendMessage() {
		if (content.length > 0) {
			if (
				$params.customInstructions &&
				convo.messages.length === 0 &&
				!convo.messages.find((m) => m.role === 'system')
			) {
				const systemMsg = {
					id: uuidv4(),
					role: 'system',
					customInstructions: true,
					content: $params.customInstructions,
				};
				convo.messages.push(systemMsg);
				convo.messages = convo.messages;
				saveMessage(systemMsg);
				saveConversation(convo);
			}

			const msg = {
				id: uuidv4(),
				role: 'user',
				content: content,
				submitted: true,
			};

			const imageUrlMapper = (image) => ({
				type: 'image_url',
				image_url: {
					url: image.url,
					detail: image.fidelity,
				},
			});

			if (pendingImages.length > 0) {
				msg.contentParts = [...pendingImages.map(imageUrlMapper)];
			}

			let fileContent = '';
			if (pendingFiles.length > 0) {
				for (const file of pendingFiles) {
					fileContent += `\`\`\`filepath="${file.path}"
${file.contents}
\`\`\`

`;
				}

				msg.content = fileContent + msg.content;
			}

			convo.messages.push(msg);
			convo.messages = convo.messages;
			await tick();
			scrollToBottom();

			saveMessage(msg);
			saveConversation(convo);

			content = '';
			pendingImages = [];
			imageUrlsBlacklist = [];
			pendingFiles = [];
			selectedFiles = [];

			await tick();
			if (innerWidth < 880) {
				inputTextareaEl.blur();
			}
			autoresizeTextarea();

			submitCompletion();
		}
	}

	let fileInputEl;
	export let inputTextareaEl;

	export function autoresizeTextarea() {
		inputTextareaEl.style.height = 'auto';
		inputTextareaEl.style.height = inputTextareaEl.scrollHeight + 2 + 'px';
	}

	async function handlePDF(file) {
		try {
			const pdfjs = await import('pdfjs-dist');

			pdfjs.GlobalWorkerOptions.workerSrc = new URL(
				'pdfjs-dist/build/pdf.worker.min.mjs',
				import.meta.url
			).toString();

			const arrayBuffer = await file.arrayBuffer();
			const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
			let contents = '';

			for (let i = 1; i <= pdf.numPages; i++) {
				const page = await pdf.getPage(i);
				const content = await page.getTextContent();
				const pageText = content.items.map((item) => item.str).join(' ');
				contents += pageText;
			}

			pendingFiles.push({ path: file.name, contents });
			pendingFiles = pendingFiles;
			tick().then(() => {
				autoresizeTextarea();
			});
		} catch (error) {
			console.error(`Error processing PDF: ${error.message}`);
		}
	}

	export async function handleFileDrop(event) {
		event.preventDefault();

		let filenames = [];
		let promises = [];
		if (event.dataTransfer.items) {
			// Use DataTransferItemList interface to access the file(s)
			[...event.dataTransfer.items].forEach((item, _) => {
				// If dropped items aren't files, reject them
				if (item.kind !== 'file') {
					return;
				}

				if (item.type === 'application/pdf') {
					handlePDF(item.getAsFile());
					return;
				}

				const file = item.getAsFile();
				filenames.push(file.name);
				promises.push(file.text());
			});
		} else {
			// Use DataTransfer interface to access the file(s)
			[...event.dataTransfer.files].forEach((file, _) => {
				filenames.push(file.name);
				promises.push(file.text());
			});
		}

		const texts = await Promise.all(promises);
		for (let i = 0; i < texts.length; i++) {
			const text = texts[i];
			const filename = filenames[i];
			pendingFiles.push({ path: filename, contents: text });
			pendingFiles = pendingFiles;
		}

		tick().then(() => {
			autoresizeTextarea();
		});
	}

	async function handlePaste(event) {
		const items = (event.clipboardData || event.originalEvent.clipboardData).items;
		for (let i = 0; i < items.length; i++) {
			if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
				const file = items[i].getAsFile();
				const dataUrl = await readFileAsDataURL(file);
				pendingImages.push({ url: dataUrl, fidelity: 'high' });
				pendingImages = pendingImages;
				tick().then(() => {
					autoresizeTextarea();
				});
			} else if (items[i].kind === 'file' && items[i].type === 'application/pdf') {
				handlePDF(items[i].getAsFile());
			}
		}
	}

	async function handleFileUpload(event) {
		const files = event.target.files;
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (file.type.startsWith('image/')) {
				const dataUrl = await readFileAsDataURL(file);
				pendingImages.push({ url: dataUrl, fidelity: 'high' });
				pendingImages = pendingImages;
				tick().then(() => {
					autoresizeTextarea();
				});
			} else if (file.type === 'application/pdf') {
				handlePDF(file);
			} else {
				const text = await file.text();
				pendingFiles.push({ path: file.name, contents: text });
				pendingFiles = pendingFiles;
				tick().then(() => {
					autoresizeTextarea();
				});
			}
		}
	}

	function formatCompactNumber(number) {
		return new Intl.NumberFormat('en-US', {
			notation: 'compact',
			compactDisplay: 'short',
			maximumFractionDigits: 1,
		}).format(number);
	}

	let containerEl, leftFadeEl, rightFadeEl;

	function updateFades() {
		if (!containerEl || !leftFadeEl || !rightFadeEl) {
			return;
		}
		const isScrollable = containerEl.scrollWidth > containerEl.clientWidth;

		if (isScrollable) {
			// Update left fade - only visible if scrolled away from start
			leftFadeEl.style.opacity = containerEl.scrollLeft > 0 ? '1' : '0';

			// Update right fade - visible if there's more content to scroll to
			const hasMoreContent =
				containerEl.scrollLeft + containerEl.clientWidth < containerEl.scrollWidth;
			rightFadeEl.style.opacity = hasMoreContent ? '1' : '0';
		} else {
			leftFadeEl.style.opacity = '0';
			rightFadeEl.style.opacity = '0';
		}
	}

	afterUpdate(() => {
		updateFades();
	});
</script>

<svelte:window
	on:resize={updateFades}
	on:keydown={(event) => {
		// Check for Command+P (macOS) or Ctrl+P (Windows/Linux) to open the file picker
		if (navigator.platform.match(/Mac|iPhone|iPod|iPad/)) {
			if (event.metaKey && event.key === 'p') {
				filesOpen = true;
				event.preventDefault();
			}
		} else if (event.ctrlKey && event.key === 'p') {
			filesOpen = true;
			event.preventDefault();
		}
	}}
/>

<div class="input-floating absolute bottom-4 left-1/2 z-[99] w-full -translate-x-1/2 px-5 ld:px-8">
	<div class="mx-auto flex w-full max-w-[680px] flex-col ld:max-w-[768px]">
		<div class="relative flex">
			{#if pendingImages.length > 0 || pendingFiles.length > 0}
				<div class="absolute left-5 top-2.5 flex gap-x-3">
					{#each pendingFiles as file, i}
						<FilePill
							{file}
							canDelete
							on:delete={() => {
								const [deleted] = pendingFiles.splice(i, 1);
								pendingFiles = pendingFiles;
								selectedFiles = selectedFiles.filter((f) => f !== deleted.path);
								tick().then(() => {
									autoresizeTextarea();
								});
							}}
						/>
					{/each}
					{#each pendingImages as image, i}
						<div class="relative">
							<img
								src={image.url}
								alt=""
								class="h-20 w-20 rounded-lg border border-slate-200 object-cover"
							/>
							<button
								on:click={() => {
									pendingImages[i].fidelity = pendingImages[i].fidelity === 'high' ? 'low' : 'high';
									pendingImages = pendingImages;
								}}
								class="absolute -bottom-1 -left-1 flex h-4 rounded-full bg-black px-1 transition-[transform,background-color] hover:scale-110 hover:bg-blue-400"
								title="Toggle image fidelity"
							>
								<span class="m-auto text-[8px] font-bold text-white">
									{pendingImages[i].fidelity === 'high' ? 'High' : 'Low'}
								</span>
							</button>
							<button
								on:click={() => {
									pendingImages.splice(i, 1);
									pendingImages = pendingImages;
									imageUrlsBlacklist.push(image.url);
									tick().then(() => {
										autoresizeTextarea();
									});
								}}
								class="absolute -bottom-1 -right-1 flex h-4 w-4 rounded-full bg-black transition-[transform,background-color] hover:scale-110 hover:bg-red-400"
							>
								<Icon icon={feX} class="m-auto h-3 w-3 text-white" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
			<textarea
				bind:this={inputTextareaEl}
				class="{isMultimodal ? 'pr-[84px]' : 'pr-14'} {pendingImages.length > 0
					? '!pt-[112px]'
					: pendingFiles.length > 0
						? '!pt-[48px]'
						: ''} max-h-[90dvh] w-full resize-none rounded-[18px] border border-slate-200 pb-14 pl-5 pt-4 font-normal text-slate-800 shadow-sm transition-colors scrollbar-slim focus:border-slate-300 focus:outline-none"
				rows={1}
				bind:value={content}
				on:paste={handlePaste}
				on:keydown={(event) => {
					if (event.key === 'Enter' && !event.shiftKey && innerWidth > 880) {
						event.preventDefault();
						sendMessage();
					}
				}}
				on:input={async () => {
					autoresizeTextarea();

					const imageLinkedUrls = content.match(imageUrlRegex) || [];
					for (const url of imageLinkedUrls) {
						if (
							!pendingImages.find((image) => image.url === url) &&
							!imageUrlsBlacklist.includes(url)
						) {
							pendingImages.push({ url, fidelity: 'high' });
							pendingImages = pendingImages;
							tick().then(() => {
								autoresizeTextarea();
							});
						}
					}
				}}
			/>

			<div class="absolute bottom-3 left-4">
				<!-- Left fade -->
				<div
					bind:this={leftFadeEl}
					class="pointer-events-none absolute bottom-0 left-0 z-10 h-full w-6 bg-gradient-to-r from-white to-transparent opacity-0 transition-opacity sm:hidden"
				/>

				<!-- Right fade -->
				<div
					bind:this={rightFadeEl}
					class="pointer-events-none absolute bottom-0 right-0 z-10 h-full w-6 bg-gradient-to-l from-white to-transparent opacity-0 transition-opacity sm:hidden"
				/>

				<div
					bind:this={containerEl}
					on:scroll={updateFades}
					class="flex max-w-[220px] gap-2 overflow-x-auto scrollbar-none sm:max-w-none sm:overflow-x-visible"
				>
					<div id="tool-dropdown" class="contents">
						<ToolPill icon={feTool} selected={toolsOpen} on:click={() => (toolsOpen = !toolsOpen)}>
							Tools
							{#if convo.tools?.length > 0}
								<span
									class="{toolsOpen
										? 'bg-white text-slate-800'
										: 'bg-slate-800 text-white'} flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] transition-colors"
								>
									{convo.tools.length}
								</span>
							{/if}
						</ToolPill>
						<ToolDropdown bind:open={toolsOpen} {convo} {saveConversation} />
					</div>

					{#if tree}
						<div id="files-dropdown" class="contents">
							<ToolPill
								icon={feFolder}
								selected={filesOpen}
								on:click={() => (filesOpen = !filesOpen)}
							>
								Files
								{#if pendingFiles.length > 0}
									<span
										class="{filesOpen
											? 'bg-white text-slate-800'
											: 'bg-slate-800 text-white'} flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] transition-colors"
									>
										{pendingFiles.length}
									</span>
								{/if}
							</ToolPill>
							<FilesDropdown
								bind:open={filesOpen}
								{tree}
								bind:selectedFiles
								on:fileSelected={async ({ detail }) => {
									const path = detail.path;
									const response = await fetch(`${$remoteServer.address}/read_file?path=${path}`);
									const contents = await response.text();
									pendingFiles = [...pendingFiles, { path, contents }];
									tick().then(() => {
										autoresizeTextarea();
									});
								}}
								on:fileDeselected={({ detail }) => {
									const path = detail.path;
									pendingFiles = pendingFiles.filter((f) => f.path !== path);
									tick().then(() => {
										autoresizeTextarea();
									});
								}}
							/>
						</div>
					{/if}

					{#if convo.models.every((m) => m.provider === 'OpenRouter')}
						<ToolPill
							icon={feSearch}
							selected={convo.websearch}
							on:click={() => {
								if (convo.websearch) {
									convo.websearch = false;
									saveConversation(convo);
								} else {
									convo.websearch = true;
									saveConversation(convo);
								}
							}}
						>
							Search
						</ToolPill>
					{/if}
					{#if convo.models[0].reasoningEffortControls === 'low-medium-high'}
						<ToolPill
							icon={feZap}
							selected={false}
							on:click={() => {
								// Toggle between low, medium, and high reasoning effort
								if (convo.reasoningEffort === 'low') {
									convo.reasoningEffort = 'medium';
									saveConversation(convo);
								} else if (convo.reasoningEffort === 'medium') {
									convo.reasoningEffort = 'high';
									saveConversation(convo);
								} else if (!convo.reasoningEffort || convo.reasoningEffort === 'high') {
									convo.reasoningEffort = 'low';
									saveConversation(convo);
								}
							}}
						>
							{#if convo.reasoningEffort === 'low'}
								Low
							{:else if convo.reasoningEffort === 'medium'}
								Medium
							{:else if !convo.reasoningEffort || convo.reasoningEffort === 'high'}
								High
							{/if}
						</ToolPill>
					{:else if convo.models[0].reasoningEffortControls === 'range'}
						<div id="reasoning-effort-dropdown" class="contents">
							<ToolPill
								icon={feZap}
								selected={reasoningEffortDropdownOpen}
								on:click={() => (reasoningEffortDropdownOpen = !reasoningEffortDropdownOpen)}
							>
								Thinking {$params.reasoningEffort['range'] === 0
									? 'off'
									: formatCompactNumber($params.reasoningEffort['range'])}
							</ToolPill>
							<ReasoningEffortRangeDropdown bind:open={reasoningEffortDropdownOpen} {convo} />
						</div>
					{/if}
				</div>
			</div>

			<div class="absolute bottom-[13px] right-4 flex gap-2">
				{#if isMultimodal}
					<button
						class="h-8 w-8 rounded-full transition-transform hover:scale-110 hover:bg-slate-200"
						on:click={() => fileInputEl.click()}
					>
						<input
							type="file"
							class="hidden"
							bind:this={fileInputEl}
							on:change={handleFileUpload}
						/>
						<Icon
							icon={fePaperclip}
							strokeWidth={2.5}
							class="m-auto h-5 w-5 text-slate-800 transition-colors group-disabled:text-slate-400"
						/>
					</button>
				{/if}
				{#if generating && convo.messages.filter((msg) => msg.generated).length > 0}
					<button
						class="group flex h-8 w-8 rounded-full bg-slate-800 transition-transform hover:scale-110"
						on:click={() => {
							handleAbort();
						}}
					>
						<Icon
							icon={feSquare}
							strokeWidth={4}
							class="m-auto h-3.5 w-3.5 text-white transition-colors group-disabled:text-slate-100"
						/>
					</button>
				{:else}
					<button
						disabled={content.length === 0}
						class="group relative flex h-8 w-8 rounded-full bg-slate-800 transition-transform hover:scale-110 disabled:bg-slate-400 disabled:hover:scale-100"
						on:click={sendMessage}
						on:mouseenter={() => {
							if (content.length === 0) {
								return;
							}
							// isHoveringSend = true;
							// calculateTokens();
						}}
						on:mouseleave={() => {
							// isHoveringSend = false;
							// tokenCount = null;
						}}
					>
						<Icon
							icon={feArrowUp}
							class="m-auto h-4 w-4 text-white transition-colors group-disabled:text-slate-100"
						/>
						{#if convo.models[0]?.provider === 'Anthropic'}
							<div
								class="absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-xl"
								class:invisible={!tokenError && !tokenCount}
							>
								{#if tokenError}
									Error: {tokenError}
								{:else}
									{tokenCount} tokens
								{/if}
							</div>
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
