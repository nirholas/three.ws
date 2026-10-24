<script>
	import JsonView from './JsonView.svelte';
	
	
	
	/**
	 * @typedef {Object} Props
	 * @property {*} json
	 * @property {number} [depth]
	 * @property {number} [_cur]
	 * @property {boolean} [_last]
	 */

	/** @type {Props} */
	let {
		json,
		depth = Infinity,
		_cur = 0,
		_last = true
	} = $props();

	let collapsed = $state(false);

	/**
	 * @param {*} i
	 * @returns {string}
	 */
	function getType(i) {
		if (i === null) return 'null';
		return typeof i;
	}

	/**
	 * @param {*} i
	 * @returns {string}
	 */
	function stringify(i) {
		return '"' + i + '"';
	}

	/**
	 * @param {*} i
	 * @returns {string}
	 */
	function format(i) {
		switch (getType(i)) {
			case 'function':
				return 'f () {...}';
			case 'symbol':
				return i.toString();
			default:
				return stringify(i);
		}
	}

	function clicked() {
		collapsed = !collapsed;
	}

	/**
	 * @param {Event} e
	 */
	function pressed(e) {
		if (e instanceof KeyboardEvent && ['Enter', ' '].includes(e.key)) clicked();
	}

	const items = $derived(getType(json) === 'object' ? Object.keys(json) : []);
	const isArray = $derived(Array.isArray(json));
	const brackets = $derived(isArray ? ['[', ']'] : ['{', '}']);

	$effect.pre(() => {
		collapsed = depth < _cur;
	});
</script>

{#if !items.length}
	<span class="_jsonBkt empty" class:isArray>{brackets[0]}{brackets[1]}</span>{#if !_last}<span
			class="_jsonSep">,</span
		>{/if}
{:else if collapsed}
	<span
		class="_jsonBkt"
		class:isArray
		role="button"
		tabindex="0"
		onclick={clicked}
		onkeydown={pressed}>{brackets[0]}...{brackets[1]}</span
	>{#if !_last && collapsed}<span class="_jsonSep">,</span>{/if}
{:else}
	<span
		class="_jsonBkt"
		class:isArray
		role="button"
		tabindex="0"
		onclick={clicked}
		onkeydown={pressed}>{brackets[0]}</span
	>
	<ul class="_jsonList">
		{#each items as i, idx}
			<li>
				{#if !isArray}
					<span class="_jsonKey">{stringify(i)}</span><span class="_jsonSep">:</span>
				{/if}
				{#if getType(json[i]) === 'object'}
					<JsonView json={json[i]} {depth} _cur={_cur + 1} _last={idx === items.length - 1} />
				{:else}
					<span class="_jsonVal {getType(json[i])}">{format(json[i])}</span
					>{#if idx < items.length - 1}<span class="_jsonSep">,</span>{/if}
				{/if}
			</li>
		{/each}
	</ul>
	<span
		class="_jsonBkt"
		class:isArray
		role="button"
		tabindex="0"
		onclick={clicked}
		onkeydown={pressed}>{brackets[1]}</span
	>{#if !_last}<span class="_jsonSep">,</span>{/if}
{/if}

<style>
	:where(:global(._jsonList)) {
		list-style: none;
		margin: 0;
		padding: 0;
		padding-left: var(--jsonPaddingLeft, 1rem);
	}
	:where(:global(._jsonBkt)) {
		color: var(--jsonBracketColor, currentcolor);
	}
	:where(:global(._jsonBkt)):not(.empty):hover {
		cursor: pointer;
		background: var(--jsonBracketHoverBackground, rgba(255,255,255,0.08));
	}
	:where(:global(._jsonSep)) {
		color: var(--jsonSeparatorColor, currentcolor);
	}
	:where(:global(._jsonKey)) {
		color: var(--jsonKeyColor, currentcolor);
	}
	:where(:global(._jsonVal)) {
		color: var(--jsonValColor, #9ca3af);
	}
	:where(:global(._jsonVal)).string {
		color: var(--jsonValStringColor, #34d399);
	}
	:where(:global(._jsonVal)).number {
		color: var(--jsonValNumberColor, #fbbf24);
	}
	:where(:global(._jsonVal)).boolean {
		color: var(--jsonValBooleanColor, #60a5fa);
	}
</style>
