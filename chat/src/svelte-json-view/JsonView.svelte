<script>
	/** @type {*} - object or array to display */
	export let json;
	/** @type {number} - initial expansion depth */
	export let depth = Infinity;
	export let _cur = 0;
	export let _last = true;

	let items = [];
	let isArray = false;
	let brackets = ['', ''];
	let collapsed = false;

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

	$: {
		items = getType(json) === 'object' ? Object.keys(json) : [];
		isArray = Array.isArray(json);
		brackets = isArray ? ['[', ']'] : ['{', '}'];
	}

	$: collapsed = depth < _cur;
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
		on:click={clicked}
		on:keydown={pressed}>{brackets[0]}...{brackets[1]}</span
	>{#if !_last && collapsed}<span class="_jsonSep">,</span>{/if}
{:else}
	<span
		class="_jsonBkt"
		class:isArray
		role="button"
		tabindex="0"
		on:click={clicked}
		on:keydown={pressed}>{brackets[0]}</span
	>
	<ul class="_jsonList">
		{#each items as i, idx}
			<li>
				{#if !isArray}
					<span class="_jsonKey">{stringify(i)}</span><span class="_jsonSep">:</span>
				{/if}
				{#if getType(json[i]) === 'object'}
					<svelte:self json={json[i]} {depth} _cur={_cur + 1} _last={idx === items.length - 1} />
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
		on:click={clicked}
		on:keydown={pressed}>{brackets[1]}</span
	>{#if !_last}<span class="_jsonSep">,</span>{/if}
{/if}

<style>
	:where(._jsonList) {
		list-style: none;
		margin: 0;
		padding: 0;
		padding-left: var(--jsonPaddingLeft, 1rem);
	}
	:where(._jsonBkt) {
		color: var(--jsonBracketColor, currentcolor);
	}
	:where(._jsonBkt):not(.empty):hover {
		cursor: pointer;
		background: var(--jsonBracketHoverBackground, #e5e7eb);
	}
	:where(._jsonSep) {
		color: var(--jsonSeparatorColor, currentcolor);
	}
	:where(._jsonKey) {
		color: var(--jsonKeyColor, currentcolor);
	}
	:where(._jsonVal) {
		color: var(--jsonValColor, #9ca3af);
	}
	:where(._jsonVal).string {
		color: var(--jsonValStringColor, #059669);
	}
	:where(._jsonVal).number {
		color: var(--jsonValNumberColor, #d97706);
	}
	:where(._jsonVal).boolean {
		color: var(--jsonValBooleanColor, #2563eb);
	}
</style>
