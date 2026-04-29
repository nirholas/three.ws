// Shared tooltip element for all instances
let tooltipElement = null;
let activeNode = null;

function createTooltipElement() {
	if (tooltipElement) return;

	tooltipElement = document.createElement('div');
	tooltipElement.style.cssText = `
    position: absolute;
    background: black;
    color: white;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    z-index: 1000;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s;
    max-width: 250px;
    display: none; /* Hide initially to prevent scrollbars */
  `;
	document.body.appendChild(tooltipElement);
}

export function tooltip(node, params = {}) {
	// Ensure tooltip element exists
	createTooltipElement();

	// Default parameters
	let { content = '', placement = 'top' } = params;

	function positionTooltip() {
		if (activeNode !== node) return;

		// Make sure tooltip is visible before measuring
		tooltipElement.style.display = 'block';

		// Update tooltip content
		tooltipElement.textContent = content;

		// Make tooltip temporarily visible but hidden for accurate measurements
		tooltipElement.style.visibility = 'hidden';
		tooltipElement.style.opacity = '0';

		// Get dimensions and position of the node and tooltip
		const nodeRect = node.getBoundingClientRect();
		const tooltipRect = tooltipElement.getBoundingClientRect();

		// Calculate initial position based on placement
		let top, left;

		switch (placement) {
			case 'top':
				top = nodeRect.top - tooltipRect.height - 8;
				left = nodeRect.left + nodeRect.width / 2 - tooltipRect.width / 2;
				break;
			case 'bottom':
				top = nodeRect.bottom + 8;
				left = nodeRect.left + nodeRect.width / 2 - tooltipRect.width / 2;
				break;
			case 'left':
				top = nodeRect.top + nodeRect.height / 2 - tooltipRect.height / 2;
				left = nodeRect.left - tooltipRect.width - 8;
				break;
			case 'right':
				top = nodeRect.top + nodeRect.height / 2 - tooltipRect.height / 2;
				left = nodeRect.right + 8;
				break;
			default:
				// Default to top
				top = nodeRect.top - tooltipRect.height - 8;
				left = nodeRect.left + nodeRect.width / 2 - tooltipRect.width / 2;
				break;
		}

		// Check for overflow and adjust position

		// Vertical overflow
		if (top < 0) {
			// If it goes off the top, switch to bottom if that was the original placement
			if (placement === 'top') {
				top = nodeRect.bottom + 8;
			} else {
				// Otherwise just keep it within viewport
				top = 8;
			}
		} else if (top + tooltipRect.height > window.innerHeight) {
			// If it goes off the bottom, switch to top if that was the original placement
			if (placement === 'bottom') {
				top = nodeRect.top - tooltipRect.height - 8;
			} else {
				// Otherwise just keep it within viewport
				top = window.innerHeight - tooltipRect.height - 8;
			}
		}

		// Horizontal overflow
		if (left < 0) {
			// If it goes off the left, switch to right if that was the original placement
			if (placement === 'left') {
				left = nodeRect.right + 8;
			} else {
				// Otherwise just keep it within viewport
				left = 8;
			}
		} else if (left + tooltipRect.width > window.innerWidth) {
			// If it goes off the right, switch to left if that was the original placement
			if (placement === 'right') {
				left = nodeRect.left - tooltipRect.width - 8;
			} else {
				// Otherwise just keep it within viewport
				left = window.innerWidth - tooltipRect.width - 8;
			}
		}

		// Apply position (accounting for page scroll)
		tooltipElement.style.top = `${top + window.scrollY}px`;
		tooltipElement.style.left = `${left + window.scrollX}px`;

		// Make tooltip visible
		tooltipElement.style.visibility = 'visible';
	}

	function showTooltip() {
		activeNode = node;
		positionTooltip();
		tooltipElement.style.opacity = '1';
	}

	function hideTooltip() {
		if (activeNode === node) {
			tooltipElement.style.opacity = '0';
			activeNode = null;
		}
	}

	function handleResize() {
		if (activeNode === node) {
			positionTooltip();
		}
	}

	function handleScroll() {
		if (activeNode === node) {
			positionTooltip();
		}
	}

	// Add event listeners
	node.addEventListener('mouseenter', showTooltip);
	node.addEventListener('mouseleave', hideTooltip);
	node.addEventListener('focus', showTooltip);
	node.addEventListener('blur', hideTooltip);
	window.addEventListener('resize', handleResize);
	window.addEventListener('scroll', handleScroll, { passive: true });

	return {
		update(newParams) {
			// Update content and placement when parameters change
			const { content: newContent = '', placement: newPlacement = 'top' } = newParams;
			content = newContent;
			placement = newPlacement;

			if (activeNode === node) {
				positionTooltip();
			}
		},
		destroy() {
			// Clean up
			node.removeEventListener('mouseenter', showTooltip);
			node.removeEventListener('mouseleave', hideTooltip);
			node.removeEventListener('focus', showTooltip);
			node.removeEventListener('blur', hideTooltip);
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('scroll', handleScroll);

			if (activeNode === node) {
				tooltipElement.style.opacity = '0';
				activeNode = null;
			}
		},
	};
}
