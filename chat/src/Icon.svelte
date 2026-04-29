<script>
	export let icon;
	let className = '';
	export { className as class };
  export let strokeWidth = 2;
	export let use = [() => {}, {}];

	$: useFn = use[0];
	$: useParams = use[1];
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
