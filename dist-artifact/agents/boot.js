/**
 * Agents directory page — initialization and event handling.
 */

import { AgentsDirectory } from '../../src/agents-directory.js';

const directory = new AgentsDirectory('#agents');

// Decode URL params
const urlParams = new URLSearchParams(window.location.search);
const initialChain = urlParams.get('chain') || 'all';
const initialSort = urlParams.get('sort') || 'newest';
const initialPage = parseInt(urlParams.get('page') || '1', 10);
const initialSearch = urlParams.get('search') || '';

// UI elements
const searchInput = document.getElementById('search');
const filterChips = document.querySelectorAll('.filter-chip');
const sortSelect = document.getElementById('sort');
const agentsContainer = document.getElementById('agents');
const emptyState = document.getElementById('empty-state');
const loadingEl = document.getElementById('loading');
const paginationEl = document.getElementById('pagination');
const pageInfo = document.getElementById('page-info');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

let currentChain = initialChain;
let currentSort = initialSort;
let currentPage = initialPage;
let currentSearch = initialSearch;

/**
 * Update URL with current state.
 */
function updateUrl() {
	const params = new URLSearchParams();
	if (currentChain !== 'all') params.set('chain', currentChain);
	if (currentSort !== 'newest') params.set('sort', currentSort);
	if (currentPage !== 1) params.set('page', currentPage);
	if (currentSearch) params.set('search', currentSearch);

	const query = params.toString();
	const path = query ? `?${query}` : '';
	window.history.replaceState({}, '', `/agents/${path}`);
}

/**
 * Load and render agents.
 */
async function render() {
	loadingEl.style.display = 'block';
	agentsContainer.innerHTML = '';
	emptyState.style.display = 'none';
	paginationEl.style.display = 'none';

	try {
		const result = await directory.load({
			chain: currentChain,
			search: currentSearch,
			sort: currentSort,
			page: currentPage,
		});

		if (result.agents.length === 0) {
			emptyState.style.display = 'block';
			loadingEl.style.display = 'none';
			return;
		}

		directory.render();
		loadingEl.style.display = 'none';
		agentsContainer.style.display = 'grid';

		// Update pagination
		const { hasNextPage, hasPrevPage, page, totalPages } = directory.getPaginationInfo();
		pageInfo.textContent = `Page ${page} of ${totalPages}`;
		prevBtn.disabled = !hasPrevPage;
		nextBtn.disabled = !hasNextPage;
		paginationEl.style.display = 'flex';

		// Scroll to top
		window.scrollTo({ top: 0, behavior: 'smooth' });
	} catch (err) {
		console.error('Failed to load agents:', err);
		loadingEl.style.display = 'none';
		emptyState.style.display = 'block';
		emptyState.querySelector('h2').textContent = 'Error loading agents';
		emptyState.querySelector('p').textContent = err.message || 'Please try again later.';
	}
}

/**
 * Handle card clicks.
 */
directory.onCardClick((agent) => {
	window.location.href = `/a/${agent.chainId}/${agent.id}`;
});

// Search input
searchInput.value = currentSearch;
searchInput.addEventListener('input', (e) => {
	currentSearch = e.target.value;
	currentPage = 1;
	updateUrl();
	render();
});

// Filter chips
filterChips.forEach((chip) => {
	const filter = chip.dataset.filter;
	if (filter === currentChain) {
		chip.classList.add('active');
	}
	chip.addEventListener('click', () => {
		filterChips.forEach((c) => c.classList.remove('active'));
		chip.classList.add('active');
		currentChain = filter;
		currentPage = 1;
		updateUrl();
		render();
	});
});

// Sort select
sortSelect.value = currentSort;
sortSelect.addEventListener('change', (e) => {
	currentSort = e.target.value;
	currentPage = 1;
	updateUrl();
	render();
});

// Pagination
prevBtn.addEventListener('click', () => {
	if (currentPage > 1) {
		currentPage--;
		updateUrl();
		render();
	}
});

nextBtn.addEventListener('click', () => {
	const info = directory.getPaginationInfo();
	if (currentPage < info.totalPages) {
		currentPage++;
		updateUrl();
		render();
	}
});

// Initial render
render();
