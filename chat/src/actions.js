const flashClasses = {
	success: '!bg-green-200 !border-green-300',
	error: '!bg-red-100 !border-red-300',
};

export function flash(node) {
	const successFn = () => {
		const classes = flashClasses['success'].split(' ');
		node.classList.add(...classes);
		setTimeout(() => {
			node.classList.remove(...classes);
		}, 1000);
	};
	const errorFn = () => {
		const classes = flashClasses['error'].split(' ');
		node.classList.add(...classes);
		setTimeout(() => {
			node.classList.remove(...classes);
		}, 1000);
	};

	node.addEventListener('flashSuccess', successFn);
	node.addEventListener('flashError', errorFn);

	return {
		destroy() {
			node.removeEventListener('flashSuccess', successFn);
			node.removeEventListener('flashError', errorFn);
		},
	};
}
