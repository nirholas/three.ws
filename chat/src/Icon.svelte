<script lang="ts">
	
	interface Props {
		icon: any;
		class?: string;
		strokeWidth?: number;
		use?: any;
	}

	let {
		icon,
		class: className = '',
		strokeWidth = 2,
		use = [() => {}, {}]
	}: Props = $props();

	let useFn = $derived(use[0]);
	let useParams = $derived(use[1]);
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width="24"
	height="24"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	use:useFn={useParams}
>
	{@html icon}
</svg>
