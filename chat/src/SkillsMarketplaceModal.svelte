<script>
	import Modal from './Modal.svelte';
	import { toolSchema, currentUser, notify } from './stores.js';

	export let open = false;

	let view = 'browse';

	// Browse state
	let skills = [];
	let loading = false;
	let searchQuery = '';
	let debouncedSearch = '';
	let selectedCategory = null;
	let page = null;
	let hasMore = false;
	let sort = 'popular';
	let installPending = {};

	// Detail expansion state
	let expandedSkillId = null;
	let detailLoading = false;
	let detail = null;
	let userRating = null;
	let hoverStar = 0;

	// Publish state
	let publishForm = {
		name: '',
		slug: '',
		description: '',
		category: '',
		tags: '',
		schemaText: JSON.stringify(
			[
				{
					name: 'my_tool',
					description: 'What this tool does',
					parameters: {
						type: 'object',
						properties: {
							query: { type: 'string', description: 'Input query' }
						},
						required: ['query']
					}
				}
			],
			null,
			2
		),
		isPublic: true
	};
	let publishError = null;
	let publishLoading = false;
	let schemaValid = null;
	let schemaErrorMsg = '';

	let categories = [];

	async function loadCategories() {
		try {
			const res = await fetch('/api/skills/categories');
			if (!res.ok) return;
			const data = await res.json();
			categories = data.categories || [];
		} catch {
			// leave categories empty
		}
	}

	// helpers

	function relativeDate(iso) {
		const diff = Date.now() - new Date(iso).getTime();
		const days = Math.floor(diff / 86400000);
		if (days === 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 30) return `${days} days ago`;
		if (days < 365) return `${Math.floor(days / 30)} months ago`;
		return `${Math.floor(days / 365)} years ago`;
	}

	function isInstalled(skill) {
		return $toolSchema.some((g) => g.name === skill.name);
	}

	function formatRating(avg, count) {
		if (!count) return 'No ratings yet';
		return `⭐ ${Number(avg).toFixed(1)} (${count})`;
	}

	function schemaPreview(schema_json) {
		if (!Array.isArray(schema_json) || schema_json.length === 0) return null;
		const first = schema_json[0];
		const fn = first?.function ?? first;
		const params = Object.keys(fn?.parameters?.properties ?? {});
		return {
			name: fn?.name ?? '?',
			description: fn?.description ?? '',
			params,
			extra: schema_json.length - 1
		};
	}

	// skills API

	async function loadSkills(reset = false) {
		loading = true;
		try {
			const p = new URLSearchParams();
			if (debouncedSearch) p.set('search', debouncedSearch);
			if (selectedCategory) p.set('category', selectedCategory);
			if (sort) p.set('sort', sort);
			if (!reset && page) p.set('cursor', page);
			const res = await fetch(`/api/skills?${p}`);
			if (!res.ok) throw new Error('Failed to load skills');
			const data = await res.json();
			skills = reset ? (data.skills || []) : [...skills, ...(data.skills || [])];
			page = data.nextCursor || null;
			hasMore = !!data.hasMore;
		} catch (e) {
			notify(e.message, 'error');
		} finally {
			loading = false;
		}
	}

	let searchTimer;
	function handleSearchInput(e) {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			debouncedSearch = e.target.value;
			page = null;
			loadSkills(true);
		}, 300);
	}

	function selectCategory(cat) {
		selectedCategory = cat;
		page = null;
		loadSkills(true);
	}

	function handleSortChange(e) {
		sort = e.target.value;
		page = null;
		loadSkills(true);
	}

	// install / uninstall

	async function toggleInstall(skill, e) {
		e?.stopPropagation();
		if (!$currentUser) { notify('Sign in to install skills', 'info'); return; }
		installPending = { ...installPending, [skill.id]: true };
		const wasInstalled = isInstalled(skill);
		if (!wasInstalled) {
			const schema = detail?.id === skill.id ? (detail.schema_json ?? []) : (skill.schema_json ?? []);
			$toolSchema = [...$toolSchema, { name: skill.name, schema }];
		} else {
			$toolSchema = $toolSchema.filter((g) => g.name !== skill.name);
		}
		try {
			const method = wasInstalled ? 'DELETE' : 'POST';
			const res = await fetch(`/api/skills/${skill.id}/install`, { method, credentials: 'include' });
			if (!res.ok) throw new Error('Request failed');
			if (!wasInstalled) {
				const data = await res.json().catch(() => null);
				if (data?.schema_json) {
					$toolSchema = [
						...$toolSchema.filter((g) => g.name !== skill.name),
						{ name: skill.name, schema: data.schema_json }
					];
				}
			}
			skills = skills.map((s) =>
				s.id === skill.id
					? { ...s, install_count: (s.install_count || 0) + (wasInstalled ? -1 : 1) }
					: s
			);
			if (detail?.id === skill.id) detail = { ...detail, is_installed: !wasInstalled };
		} catch (e) {
			if (!wasInstalled) {
				$toolSchema = $toolSchema.filter((g) => g.name !== skill.name);
			} else {
				$toolSchema = [...$toolSchema, { name: skill.name, schema: skill.schema_json ?? [] }];
			}
			notify(e.message, 'error');
		} finally {
			const next = { ...installPending };
			delete next[skill.id];
			installPending = next;
		}
	}

	// detail expansion

	async function toggleExpand(skill) {
		if (expandedSkillId === skill.id) {
			expandedSkillId = null;
			detail = null;
			return;
		}
		expandedSkillId = skill.id;
		detail = null;
		userRating = null;
		hoverStar = 0;
		detailLoading = true;
		try {
			const res = await fetch(`/api/skills/${skill.id}`);
			if (!res.ok) throw new Error('Failed to load details');
			detail = await res.json();
			userRating = detail.user_rating ?? null;
		} catch (e) {
			notify(e.message, 'error');
			expandedSkillId = null;
		} finally {
			detailLoading = false;
		}
	}

	// rating

	async function submitRating(skillId, rating) {
		if (!$currentUser) return;
		try {
			const res = await fetch(`/api/skills/${skillId}/rate`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rating })
			});
			if (!res.ok) throw new Error('Rating failed');
			const data = await res.json();
			userRating = rating;
			if (detail?.id === skillId) {
				detail = { ...detail, avg_rating: data.avg_rating, rating_count: data.rating_count };
			}
			skills = skills.map((s) =>
				s.id === skillId
					? { ...s, avg_rating: data.avg_rating, rating_count: data.rating_count }
					: s
			);
		} catch (e) {
			notify(e.message, 'error');
		}
	}

	// copy slug

	async function copySlug(slug, e) {
		e?.stopPropagation();
		try {
			await navigator.clipboard.writeText(slug);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = slug;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
		}
		notify('Copied!', 'success');
	}

	// publish

	function nameToSlug(name) {
		return name
			.toLowerCase()
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9-]/g, '');
	}

	function handleNameInput(e) {
		publishForm.name = e.target.value;
		publishForm.slug = nameToSlug(publishForm.name);
	}

	function validateSchema() {
		try {
			JSON.parse(publishForm.schemaText);
			schemaValid = true;
			schemaErrorMsg = '';
		} catch (e) {
			schemaValid = false;
			schemaErrorMsg = e.message;
		}
	}

	async function publishSkill() {
		publishError = null;
		validateSchema();
		if (!schemaValid) {
			publishError = 'Fix JSON errors before publishing';
			return;
		}
		publishLoading = true;
		try {
			const tags = publishForm.tags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			const res = await fetch('/api/skills', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: publishForm.name,
					slug: publishForm.slug,
					description: publishForm.description,
					category: publishForm.category,
					tags,
					schema_json: JSON.parse(publishForm.schemaText),
					is_public: publishForm.isPublic
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || 'Publish failed');
			}
			notify('Skill published!', 'success');
			view = 'browse';
			await loadSkills(true);
		} catch (e) {
			publishError = e.message;
		} finally {
			publishLoading = false;
		}
	}

	// init and keyboard

	$: if (open && skills.length === 0) {
		Promise.all([loadSkills(true), loadCategories()]);
	}

	$: tagPills = publishForm.tags
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);

	function handleKeydown(e) {
		if (!open) return;
		if (e.key === 'Escape' && expandedSkillId !== null) {
			e.stopPropagation();
			expandedSkillId = null;
			detail = null;
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<Modal bind:open class="md:w-[820px] max-w-[820px]">
	<!-- Tab bar -->
	<div class="-mx-5 mb-4 flex border-b border-slate-200 px-5">
		<button
			class="mr-4 border-b-2 pb-2 text-[13px] font-medium transition-colors {view === 'browse'
				? 'border-indigo-500 text-indigo-600'
				: 'border-transparent text-slate-500 hover:text-slate-700'}"
			on:click={() => (view = 'browse')}
		>
			Browse
		</button>
		<button
			class="border-b-2 pb-2 text-[13px] font-medium transition-colors {view === 'publish'
				? 'border-indigo-500 text-indigo-600'
				: 'border-transparent text-slate-500 hover:text-slate-700'}"
			on:click={() => (view = 'publish')}
		>
			Publish
		</button>
	</div>

	{#if view === 'browse'}
		<div class="flex min-h-[420px] gap-x-4">
			<!-- Sidebar -->
			<aside class="hidden w-40 shrink-0 flex-col gap-y-0.5 md:flex">
				<button
					class="rounded-md px-3 py-1.5 text-left text-[12px] font-medium transition-colors {selectedCategory === null
						? 'bg-indigo-50 text-indigo-700'
						: 'text-slate-600 hover:bg-slate-100'}"
					on:click={() => selectCategory(null)}
				>
					All skills
				</button>
				{#each categories as cat}
					<button
						class="rounded-md px-3 py-1.5 text-left text-[12px] transition-colors {selectedCategory === cat
							? 'bg-indigo-50 font-medium text-indigo-700'
							: 'text-slate-600 hover:bg-slate-100'}"
						on:click={() => selectCategory(cat)}
					>
						{cat}
					</button>
				{/each}
			</aside>

			<!-- Main panel -->
			<div class="min-w-0 flex-1">
				<!-- Search + sort -->
				<div class="mb-4 flex gap-x-2">
					<input
						type="text"
						placeholder="Search skills..."
						bind:value={searchQuery}
						on:input={handleSearchInput}
						class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
					/>
					<select
						on:change={handleSortChange}
						class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-600 outline-none focus:border-indigo-400"
					>
						<option value="popular">Popular</option>
						<option value="newest">Newest</option>
						<option value="az">A-Z</option>
					</select>
				</div>

				<!-- Category filter on mobile -->
				<div class="mb-3 flex flex-wrap gap-1.5 md:hidden">
					<button
						class="rounded-full border px-2.5 py-0.5 text-[11px] {selectedCategory === null
							? 'border-indigo-400 bg-indigo-50 text-indigo-700'
							: 'border-slate-200 text-slate-500'}"
						on:click={() => selectCategory(null)}>All</button
					>
					{#each categories as cat}
						<button
							class="rounded-full border px-2.5 py-0.5 text-[11px] {selectedCategory === cat
								? 'border-indigo-400 bg-indigo-50 text-indigo-700'
								: 'border-slate-200 text-slate-500'}"
							on:click={() => selectCategory(cat)}>{cat}</button
						>
					{/each}
				</div>

				{#if loading && skills.length === 0}
					<p class="mt-8 text-center text-[13px] text-slate-400">Loading skills...</p>
				{:else if skills.length === 0}
					<p class="mt-8 text-center text-[13px] text-slate-400">No skills found</p>
				{:else}
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						{#each skills as skill (skill.id)}
							<!-- Card -->
							<!-- svelte-ignore a11y-click-events-have-key-events -->
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<div
								class="cursor-pointer rounded-lg border px-3 py-3 transition-colors {expandedSkillId === skill.id
									? 'border-indigo-300 bg-indigo-50/30 ring-1 ring-indigo-200'
									: 'border-slate-200 hover:border-slate-300'}"
								on:click={() => toggleExpand(skill)}
								aria-expanded={expandedSkillId === skill.id}
							>
								<div class="flex items-start justify-between gap-x-3">
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
											<span class="text-[13px] font-medium text-slate-800">{skill.name}</span>
											{#if skill.category}
												<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500"
													>{skill.category}</span
												>
											{/if}
										</div>
										<p class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
											{skill.description || ''}
										</p>
										<div class="mt-1.5 flex items-center gap-x-3 text-[11px] text-slate-400">
											<span>{skill.install_count || 0} installs</span>
											<span>{formatRating(skill.avg_rating, skill.rating_count)}</span>
											<span>by {skill.author?.display_name || skill.author_name || 'System'}</span>
										</div>
									</div>

									{#if !$currentUser}
										<span class="shrink-0 text-[11px] text-slate-400">Sign in to install</span>
									{:else if installPending[skill.id]}
										<span
											class="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] text-slate-400"
											>...</span
										>
									{:else if isInstalled(skill)}
										<button
											class="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
											on:click={(e) => toggleInstall(skill, e)}
										>
											Remove
										</button>
									{:else}
										<button
											class="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-100"
											on:click={(e) => toggleInstall(skill, e)}
										>
											Install
										</button>
									{/if}
								</div>
							</div>

							<!-- Inline detail expansion (spans both grid columns) -->
							{#if expandedSkillId === skill.id}
								<div
									class="col-span-1 rounded-lg border border-indigo-200 bg-white p-4 sm:col-span-2"
									role="region"
									aria-label="{skill.name} details"
								>
									{#if detailLoading}
										<div class="flex animate-pulse flex-col gap-2">
											<div class="h-3 w-3/4 rounded bg-slate-200"></div>
											<div class="h-3 w-1/2 rounded bg-slate-200"></div>
											<div class="h-3 w-2/3 rounded bg-slate-200"></div>
											<div class="mt-1 h-16 rounded bg-slate-200"></div>
										</div>
									{:else if detail}
										<div class="flex flex-col gap-4 md:flex-row">

											<!-- Left column (60%) -->
											<div class="flex flex-col gap-2 md:flex-[6]">
												<p class="text-[13px] leading-relaxed text-slate-700">{detail.description || ''}</p>
												{#if detail.tags?.length}
													<div class="flex flex-wrap gap-1">
														{#each detail.tags as tag}
															<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
																>{tag}</span
															>
														{/each}
													</div>
												{/if}
												<p class="text-[12px] text-slate-500">
													By {detail.author?.display_name ?? 'the 3D-Agent team'}
												</p>
												<p class="text-[11px] text-slate-400">
													{detail.install_count ?? 0} installs{detail.created_at
														? ` - Published ${relativeDate(detail.created_at)}`
														: ''}
												</p>
											</div>

											<!-- Right column (40%) -->
											<div class="flex flex-col gap-3 md:flex-[4]">

												<!-- Star rating -->
												<div>
													<div
														class="flex items-center gap-0.5"
														title={$currentUser ? undefined : 'Sign in to rate'}
													>
														{#each [1, 2, 3, 4, 5] as star}
															<button
																class="text-xl leading-none transition-transform duration-100 {$currentUser && !userRating
																	? 'cursor-pointer hover:scale-110'
																	: 'cursor-default'}"
																style="color: {userRating && star <= userRating
																	? '#6366f1'
																	: hoverStar >= star ||
																		  (!userRating && star <= Math.round(detail.avg_rating ?? 0))
																		? '#f59e0b'
																		: '#d1d5db'}"
																on:click={() => {
																	if ($currentUser && !userRating) submitRating(detail.id, star);
																}}
																on:mouseenter={() => {
																	if ($currentUser && !userRating) hoverStar = star;
																}}
																on:mouseleave={() => (hoverStar = 0)}
																tabindex={$currentUser && !userRating ? 0 : -1}
																aria-label="Rate {star} star{star > 1 ? 's' : ''}"
															>*</button>
														{/each}
														<span class="ml-1.5 text-[11px] text-slate-400">
															{detail.avg_rating
																? Number(detail.avg_rating).toFixed(1)
																: 'No ratings'}
															({detail.rating_count ?? 0})
														</span>
													</div>
													{#if !$currentUser}
														<p class="mt-0.5 text-[11px] text-slate-400">Sign in to rate</p>
													{:else if userRating}
														<p class="mt-0.5 text-[11px] text-indigo-500">You rated {userRating}/5</p>
													{/if}
												</div>

												<!-- Schema preview -->
												{#if detail.schema_json}
													{@const preview = schemaPreview(detail.schema_json)}
													{#if preview}
														<div>
															<p class="mb-1 text-[11px] font-medium text-slate-600">Schema preview</p>
															<pre
																class="overflow-x-auto whitespace-pre-wrap break-words rounded border border-slate-100 bg-slate-50 p-2 text-[11px] leading-relaxed"
															><code>{preview.name}
{preview.description}{preview.params.length
																	? `\nparams: ${preview.params.join(', ')}`
																	: ''}{preview.extra > 0
																	? `\nand ${preview.extra} more tool${preview.extra > 1 ? 's' : ''}`
																	: ''}</code></pre>
														</div>
													{/if}
												{/if}

											</div>
										</div>

										<!-- Action row -->
										<div class="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
											{#if !$currentUser}
												<span class="text-[12px] text-slate-400">Sign in to install skills</span>
											{:else if installPending[skill.id]}
												<span
													class="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] text-slate-400"
													>...</span
												>
											{:else if isInstalled(skill)}
												<button
													class="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
													on:click={(e) => toggleInstall(skill, e)}
												>
													Remove skill
												</button>
											{:else}
												<button
													class="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[12px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
													on:click={(e) => toggleInstall(skill, e)}
												>
													Install skill
												</button>
											{/if}
											<button
												class="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] text-slate-600 transition-colors hover:bg-slate-50"
												on:click={(e) => copySlug(skill.slug, e)}
											>
												Copy slug
											</button>
										</div>
									{/if}
								</div>
							{/if}
						{/each}
					</div>

					{#if hasMore}
						<button
							class="mt-4 w-full rounded-lg border border-slate-200 py-2 text-[12px] text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
							disabled={loading}
							on:click={() => loadSkills(false)}
						>
							{loading ? 'Loading...' : 'Load more'}
						</button>
					{/if}
				{/if}
			</div>
		</div>
	{:else}
		<!-- Publish form -->
		<div class="flex max-w-lg flex-col gap-y-4">
			<h2 class="text-[14px] font-semibold text-slate-800">Publish a skill</h2>

			<div class="flex flex-col gap-y-1">
				<label for="pf-name" class="text-[12px] font-medium text-slate-600">Name</label>
				<input
					id="pf-name"
					type="text"
					bind:value={publishForm.name}
					on:input={handleNameInput}
					placeholder="My Skill"
					class="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
				/>
			</div>

			<div class="flex flex-col gap-y-1">
				<label for="pf-slug" class="text-[12px] font-medium text-slate-600">Slug</label>
				<input
					id="pf-slug"
					type="text"
					bind:value={publishForm.slug}
					placeholder="my-skill"
					class="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
				/>
				{#if publishForm.slug}
					<p class="text-[11px] text-slate-400">Preview: /skills/{publishForm.slug}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-y-1">
				<label for="pf-desc" class="text-[12px] font-medium text-slate-600">Description</label>
				<textarea
					id="pf-desc"
					bind:value={publishForm.description}
					placeholder="Describe what this skill does..."
					rows="3"
					class="resize-none rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
				/>
			</div>

			<div class="flex gap-x-3">
				<div class="flex flex-1 flex-col gap-y-1">
					<label for="pf-cat" class="text-[12px] font-medium text-slate-600">Category</label>
					<input
						id="pf-cat"
						type="text"
						list="skill-categories"
						bind:value={publishForm.category}
						placeholder="e.g. Search"
						class="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
					/>
					<datalist id="skill-categories">
						{#each categories as cat}
							<option value={cat} />
						{/each}
					</datalist>
				</div>

				<div class="flex flex-1 flex-col gap-y-1">
					<label for="pf-tags" class="text-[12px] font-medium text-slate-600">Tags (comma-separated)</label>
					<input
						id="pf-tags"
						type="text"
						bind:value={publishForm.tags}
						placeholder="search, web, api"
						class="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
					/>
				</div>
			</div>

			{#if tagPills.length}
				<div class="flex flex-wrap gap-1">
					{#each tagPills as tag}
						<span class="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] text-indigo-600"
							>{tag}</span
						>
					{/each}
				</div>
			{/if}

			<div class="flex flex-col gap-y-1">
				<label for="pf-schema" class="text-[12px] font-medium text-slate-600">Schema (JSON)</label>
				<textarea
					id="pf-schema"
					bind:value={publishForm.schemaText}
					rows="10"
					spellcheck="false"
					class="resize-y rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-[12px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
				/>
				<div class="flex items-center gap-x-2">
					<button
						type="button"
						class="rounded-lg border border-slate-200 px-3 py-1 text-[11px] text-slate-600 transition-colors hover:bg-slate-50"
						on:click={validateSchema}
					>
						Validate JSON
					</button>
					{#if schemaValid === true}
						<span class="text-[11px] text-green-600">Valid</span>
					{:else if schemaValid === false}
						<span class="text-[11px] text-red-500">{schemaErrorMsg}</span>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-x-2">
				<input
					id="skill-public"
					type="checkbox"
					bind:checked={publishForm.isPublic}
					class="h-3.5 w-3.5 accent-indigo-500"
				/>
				<label for="skill-public" class="text-[12px] text-slate-600">Make public</label>
			</div>

			{#if publishError}
				<p class="text-[12px] text-red-500">{publishError}</p>
			{/if}

			<button
				type="button"
				disabled={publishLoading || !publishForm.name || !publishForm.slug}
				class="self-start rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
				on:click={publishSkill}
			>
				{publishLoading ? 'Publishing...' : 'Publish skill'}
			</button>
		</div>
	{/if}
</Modal>
