<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { v4 as uuidv4 } from 'uuid';
	import Icon from '../Icon.svelte';
	import {
		feArrowUp,
		fePaperclip,
		feSquare,
		feX,
		feZap,
		feTool,
		feSearch,
		feFolder,
		feMic,
		feMicOff,
	} from '../feather.js';
	import { readFileAsDataURL } from '../util.js';
	import { params, remoteServer, brandConfig, composerFill } from '../stores.js';
	import ToolPill from '../ToolPill.svelte';
	import ToolDropdown from '../ToolDropdown.svelte';
	import ReasoningEffortRangeDropdown from '../ReasoningEffortRangeDropdown.svelte';
	import FilesDropdown from '../FilesDropdown.svelte';
	import FilePill from '../FilePill.svelte';

	const imageUrlRegex = /https?:\/\/[^\s]+?\.(png|jpe?g)(?=\s|$)/gi;

	let content = $state('');
	let pendingImages = $state([]);
	let imageUrlsBlacklist = $state([]);
	let pendingFiles = $state([]);
	let selectedFiles = $state([]);

	let toolsOpen = $state(false);
	let filesOpen = $state(false);
	let reasoningEffortDropdownOpen = $state(false);

	const unsubFill = composerFill.subscribe((fill) => {
		if (!fill) return;
		composerFill.set(null);
		const shouldFill = !fill.ifEmpty || !content;
		if (shouldFill) {
			// `append` adds to what is already composed instead of replacing it,
			// so a flow can layer a hint onto a half-written prompt.
			content = fill.append && content ? `${content.trimEnd()} ${fill.text}` : fill.text;
			tick().then(() => {
				autoresizeTextarea();
				if (fill.submit) sendMessage();
			});
		}
	});
	onDestroy(unsubFill);


	let fileInputEl = $state();
	interface Props {
		// Input.svelte-compatible props
		generating: any;
		convo: any;
		saveMessage: any;
		saveConversation: any;
		submitCompletion: any;
		scrollToBottom: any;
		handleAbort: any;
		tree: any;
		// three.ws-specific props
		placeholder?: string;
		mode?: any;
		modes?: any;
		onModeClear?: any;
		inputTextareaEl: any;
	}

	let {
		generating,
		convo = $bindable(),
		saveMessage,
		saveConversation,
		submitCompletion,
		scrollToBottom,
		handleAbort,
		tree,
		placeholder = 'Assign a task or ask anything',
		mode = null,
		modes = [],
		onModeClear = () => {},
		inputTextareaEl = $bindable()
	}: Props = $props();

	export function autoresizeTextarea() {
		if (!inputTextareaEl) return;
		inputTextareaEl.style.height = 'auto';
		inputTextareaEl.style.height = Math.min(inputTextareaEl.scrollHeight + 2, 320) + 'px';
	}

	function formatCompactNumber(number) {
		return new Intl.NumberFormat('en-US', {
			notation: 'compact',
			compactDisplay: 'short',
			maximumFractionDigits: 1,
		}).format(number);
	}

	async function sendMessage() {
		if (!canSend) return;

		const _effectiveSystemPrompt = $params.customInstructions || $brandConfig.system_prompt;
		if (
			_effectiveSystemPrompt &&
			convo.messages.length === 0 &&
			!convo.messages.find((m) => m.role === 'system')
		) {
			const systemMsg = {
				id: uuidv4(),
				role: 'system',
				customInstructions: true,
				content: _effectiveSystemPrompt,
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

		if (pendingImages.length > 0) {
			msg.contentParts = pendingImages.map((image) => ({
				type: 'image_url',
				image_url: { url: image.url, detail: image.fidelity },
			}));
		}

		if (pendingFiles.length > 0) {
			let fileContent = '';
			for (const file of pendingFiles) {
				fileContent += `\`\`\`filepath="${file.path}"\n${file.contents}\n\`\`\`\n\n`;
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
				const pageContent = await page.getTextContent();
				contents += pageContent.items.map((item) => item.str).join(' ');
			}

			pendingFiles.push({ path: file.name, contents });
			pendingFiles = pendingFiles;
			tick().then(() => autoresizeTextarea());
		} catch (error) {
			console.error(`Error processing PDF: ${error.message}`);
		}
	}

	export async function handleFileDrop(event) {
		event.preventDefault();

		const filenames = [];
		const promises = [];

		if (event.dataTransfer.items) {
			[...event.dataTransfer.items].forEach((item) => {
				if (item.kind !== 'file') return;
				if (item.type === 'application/pdf') {
					handlePDF(item.getAsFile());
					return;
				}
				const file = item.getAsFile();
				filenames.push(file.name);
				promises.push(file.text());
			});
		} else {
			[...event.dataTransfer.files].forEach((file) => {
				filenames.push(file.name);
				promises.push(file.text());
			});
		}

		const texts = await Promise.all(promises);
		for (let i = 0; i < texts.length; i++) {
			pendingFiles.push({ path: filenames[i], contents: texts[i] });
			pendingFiles = pendingFiles;
		}
		tick().then(() => autoresizeTextarea());
	}

	async function handlePaste(event) {
		const items = (event.clipboardData || event.originalEvent.clipboardData).items;
		for (let i = 0; i < items.length; i++) {
			if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
				const file = items[i].getAsFile();
				const dataUrl = await readFileAsDataURL(file);
				pendingImages.push({ url: dataUrl, fidelity: 'high' });
				pendingImages = pendingImages;
				tick().then(() => autoresizeTextarea());
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
				tick().then(() => autoresizeTextarea());
			} else if (file.type === 'application/pdf') {
				handlePDF(file);
			} else {
				const text = await file.text();
				pendingFiles.push({ path: file.name, contents: text });
				pendingFiles = pendingFiles;
				tick().then(() => autoresizeTextarea());
			}
		}
		// reset so the same file can be re-selected
		event.target.value = '';
	}

	let recording = $state(false);
	let recognition = null;

	function toggleVoiceInput() {
		if (recording) {
			recognition?.stop();
			recording = false;
			return;
		}
		const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SR) {
			alert('Speech recognition is not supported in this browser. Try Chrome or Edge.');
			return;
		}
		recognition = new SR();
		recognition.lang = 'en-US';
		recognition.interimResults = false;
		recognition.onresult = (e) => {
			const transcript = e.results[0][0].transcript;
			content = content ? content + ' ' + transcript : transcript;
			tick().then(() => autoresizeTextarea());
		};
		recognition.onerror = () => { recording = false; };
		recognition.onend = () => { recording = false; };
		recognition.start();
		recording = true;
	}

	let containerEl = $state(), leftFadeEl = $state(), rightFadeEl = $state();

	function updateFades() {
		if (!containerEl || !leftFadeEl || !rightFadeEl) return;
		const isScrollable = containerEl.scrollWidth > containerEl.clientWidth;
		if (isScrollable) {
			leftFadeEl.style.opacity = containerEl.scrollLeft > 0 ? '1' : '0';
			const hasMore = containerEl.scrollLeft + containerEl.clientWidth < containerEl.scrollWidth;
			rightFadeEl.style.opacity = hasMore ? '1' : '0';
		} else {
			leftFadeEl.style.opacity = '0';
			rightFadeEl.style.opacity = '0';
		}
	}

	// The pill row changes width whenever pills mount, unmount or resize, so watch the
	// row itself rather than guessing which state changes affect it.
	$effect(() => {
		if (!containerEl) return;
		updateFades();
		const resize = new ResizeObserver(updateFades);
		resize.observe(containerEl);
		const mutation = new MutationObserver(updateFades);
		mutation.observe(containerEl, { childList: true, subtree: true, characterData: true });
		return () => {
			resize.disconnect();
			mutation.disconnect();
		};
	});

	let isMultimodal = $derived(convo.models[0].modality === 'text+image->text');
	let canSend = $derived(content.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0);
	let isGenerating = $derived(generating && convo.messages.filter((msg) => msg.generated).length > 0);
</script>

<svelte:window
	onresize={updateFades}
	onkeydown={(event) => {
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

<div class="input-floating absolute bottom-4 left-1/2 z-[99] w-full -translate-x-1/2 px-6">
	<div class="mx-auto flex w-full max-w-[760px] flex-col">
		<!-- Composer card -->
		<div
			class="bg-white border border-rule rounded-[20px] shadow-composer pt-5 px-5 pb-3"
			style="min-height:140px"
		>
			<!-- Textarea -->
			<textarea
				bind:this={inputTextareaEl}
				bind:value={content}
				{placeholder}
				rows={1}
				class="w-full resize-none bg-transparent border-0 p-0 outline-none ring-0 focus:outline-none focus:ring-0 text-base text-ink placeholder-ink-faint font-sans overflow-y-auto scrollbar-ultraslim"
				style="max-height:320px;"
				onpaste={handlePaste}
				onkeydown={(event) => {
					if (event.key === 'Enter' && !event.shiftKey && innerWidth > 880) {
						event.preventDefault();
						sendMessage();
					} else if (event.key === 'Escape') {
						event.currentTarget.blur();
					}
				}}
				oninput={async () => {
					autoresizeTextarea();
					const imageLinkedUrls = content.match(imageUrlRegex) || [];
					for (const url of imageLinkedUrls) {
						if (
							!pendingImages.find((img) => img.url === url) &&
							!imageUrlsBlacklist.includes(url)
						) {
							pendingImages.push({ url, fidelity: 'high' });
							pendingImages = pendingImages;
							tick().then(() => autoresizeTextarea());
						}
					}
				}}
			></textarea>

			<!-- Attachment chips -->
			{#if pendingFiles.length > 0 || pendingImages.length > 0}
				<div class="flex flex-wrap gap-2 mt-3">
					{#each pendingFiles as file, i}
						<FilePill
							{file}
							canDelete
							ondelete={() => {
								const [deleted] = pendingFiles.splice(i, 1);
								pendingFiles = pendingFiles;
								selectedFiles = selectedFiles.filter((f) => f !== deleted.path);
								tick().then(() => autoresizeTextarea());
							}}
						/>
					{/each}
					{#each pendingImages as image, i}
						<div class="relative">
							<img
								src={image.url}
								alt=""
								class="h-16 w-16 rounded-lg border border-rule object-cover"
							/>
							<button
								onclick={() => {
									pendingImages[i].fidelity =
										pendingImages[i].fidelity === 'high' ? 'low' : 'high';
									pendingImages = pendingImages;
								}}
								class="absolute -bottom-1 -left-1 flex h-4 rounded-full bg-black px-1 transition-[transform,background-color] hover:scale-110 hover:bg-blue-400"
								title="Toggle image fidelity"
							>
								<span class="m-auto text-[8px] font-bold text-white">
									{pendingImages[i].fidelity === 'high' ? 'Hi' : 'Lo'}
								</span>
							</button>
							<button
								onclick={() => {
									pendingImages.splice(i, 1);
									pendingImages = pendingImages;
									imageUrlsBlacklist.push(image.url);
									tick().then(() => autoresizeTextarea());
								}}
								class="absolute -bottom-1 -right-1 flex h-4 w-4 rounded-full bg-black transition-[transform,background-color] hover:scale-110 hover:bg-red-400"
							>
								<Icon icon={feX} class="m-auto h-3 w-3 text-white" />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Footer row -->
			<div class="flex items-center justify-between mt-3">
				<!-- Left side: attach + mode pill + tool pills -->
				<div class="flex items-center gap-2 min-w-0">
					<!-- "+" attach button -->
					<button
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rule bg-white text-ink hover:bg-paper-deep transition-colors text-xl leading-none"
						onclick={() => fileInputEl.click()}
						title="Attach files"
					>
						<input
							type="file"
							class="hidden"
							bind:this={fileInputEl}
							multiple
							onchange={handleFileUpload}
						/>
						+
					</button>

					<!-- Selected mode pill -->
					{#if mode}
						<div
							class="flex shrink-0 items-center gap-1 rounded-full border border-rule bg-paper px-3 py-1 text-xs text-ink"
						>
							{#if modes.find((m) => m.id === mode)?.icon}
								<Icon icon={modes.find((m) => m.id === mode).icon} class="h-3 w-3" />
							{/if}
							<span>{modes.find((m) => m.id === mode)?.label ?? mode}</span>
							<button
								class="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-rule transition-colors"
								onclick={onModeClear}
							>
								<Icon icon={feX} class="h-2.5 w-2.5" />
							</button>
						</div>
					{/if}

					<!-- Tool pills row -->
					<div class="relative min-w-0">
						<div
							bind:this={leftFadeEl}
							class="pointer-events-none absolute left-0 top-0 z-10 h-full w-4 bg-gradient-to-r from-white to-transparent opacity-0 transition-opacity"
						></div>
						<div
							bind:this={rightFadeEl}
							class="pointer-events-none absolute right-0 top-0 z-10 h-full w-4 bg-gradient-to-l from-white to-transparent opacity-0 transition-opacity"
						></div>
						<div
							bind:this={containerEl}
							onscroll={updateFades}
							class="flex max-w-[200px] gap-1.5 overflow-x-auto scrollbar-none sm:max-w-none"
						>
							<div id="tool-dropdown" class="contents">
								<ToolPill
									icon={feTool}
									selected={toolsOpen}
									onclick={() => (toolsOpen = !toolsOpen)}
								>
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
										onclick={() => (filesOpen = !filesOpen)}
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
										onfileSelected={async (detail) => {
											const path = detail.path;
											const response = await fetch(
												`${$remoteServer.address}/read_file?path=${path}`
											);
											const contents = await response.text();
											pendingFiles = [...pendingFiles, { path, contents }];
											tick().then(() => autoresizeTextarea());
										}}
										onfileDeselected={(detail) => {
											pendingFiles = pendingFiles.filter((f) => f.path !== detail.path);
											tick().then(() => autoresizeTextarea());
										}}
									/>
								</div>
							{/if}

							{#if convo.models.every((m) => m.provider === 'OpenRouter')}
								<ToolPill
									icon={feSearch}
									selected={convo.websearch}
									onclick={() => {
										convo.websearch = !convo.websearch;
										saveConversation(convo);
									}}
								>
									Search
								</ToolPill>
							{/if}

							{#if convo.models[0].reasoningEffortControls === 'low-medium-high'}
								<ToolPill
									icon={feZap}
									selected={false}
									onclick={() => {
										if (convo.reasoningEffort === 'low') {
											convo.reasoningEffort = 'medium';
										} else if (convo.reasoningEffort === 'medium') {
											convo.reasoningEffort = 'high';
										} else {
											convo.reasoningEffort = 'low';
										}
										saveConversation(convo);
									}}
								>
									{convo.reasoningEffort === 'low'
										? 'Low'
										: convo.reasoningEffort === 'medium'
											? 'Medium'
											: 'High'}
								</ToolPill>
							{:else if convo.models[0].reasoningEffortControls === 'range'}
								<div id="reasoning-effort-dropdown" class="contents">
									<ToolPill
										icon={feZap}
										selected={reasoningEffortDropdownOpen}
										onclick={() =>
											(reasoningEffortDropdownOpen = !reasoningEffortDropdownOpen)}
									>
										Thinking
										{$params.reasoningEffort['range'] === 0
											? 'off'
											: formatCompactNumber($params.reasoningEffort['range'])}
									</ToolPill>
									<ReasoningEffortRangeDropdown
										bind:open={reasoningEffortDropdownOpen}
										{convo}
									/>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Right side: mic + send / stop button -->
				<div class="ml-3 flex shrink-0 items-center gap-2">
					<button
						type="button"
						title={recording ? 'Stop recording' : 'Speak a message'}
						onclick={toggleVoiceInput}
						class="flex h-9 w-9 items-center justify-center rounded-full transition-colors
							{recording ? 'bg-red-500 text-white animate-pulse' : 'text-ink-faint hover:text-ink'}"
					>
						<Icon icon={recording ? feMicOff : feMic} class="h-4 w-4" />
					</button>
					{#if isGenerating}
						<button
							class="flex h-9 w-9 items-center justify-center rounded-full bg-ink transition-colors hover:bg-[#333]"
							onclick={handleAbort}
							title="Stop generating"
						>
							<Icon icon={feSquare} strokeWidth={4} class="h-3.5 w-3.5 text-white" />
						</button>
					{:else}
						<button
							disabled={!canSend}
							class="flex h-9 w-9 items-center justify-center rounded-full transition-colors {canSend
								? 'bg-black text-white hover:bg-[#333] cursor-pointer'
								: 'bg-paper-deep text-ink-faint cursor-default'}"
							onclick={sendMessage}
							title="Send message"
						>
							<Icon icon={feArrowUp} class="h-4 w-4" />
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>
