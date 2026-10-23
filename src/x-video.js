// Free X video tool page: POST /api/x-video/extract, then one download link per mp4 variant
// routed through GET /api/x-video/download (restricted to X's media CDNs).

const form = document.getElementById('xv-form');
const input = document.getElementById('xv-url');
const button = document.getElementById('xv-go');
const statusEl = document.getElementById('xv-status');
const result = document.getElementById('xv-result');

const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function el(tag, props = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else node.setAttribute(k, v);
	}
	for (const c of children) if (c) node.append(c);
	return node;
}

function showError(title, message) {
	result.replaceChildren();
	statusEl.replaceChildren(el('div', { class: 'xv-error' }, el('strong', { text: title }), document.createTextNode(message)));
}

function showLoading() {
	statusEl.replaceChildren();
	result.replaceChildren(
		el('div', { class: 'xv-card', 'aria-hidden': 'true' }, el('div', { class: 'xv-skel' }), el('div', { class: 'xv-skel' }), el('div', { class: 'xv-skel' })),
	);
}

function metricItem(label, value) {
	if (value == null) return null;
	return el('li', {}, el('b', { text: nf.format(value) }), document.createTextNode(` ${label}`));
}

function formatBytesEstimate(variant, durationMs) {
	if (!variant.bitrate || !durationMs) return '';
	const mb = (variant.bitrate * (durationMs / 1000)) / 8 / 1e6;
	return `about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function render(data) {
	const { post, videos, duration_ms: durationMs, thumbnail } = data;
	const card = el('div', { class: 'xv-card' });

	const video = el('video', { class: 'xv-video', controls: '', playsinline: '', preload: 'metadata' });
	if (thumbnail) video.setAttribute('poster', thumbnail);
	video.src = videos[0].url;
	card.append(video);

	const author = el('div', { class: 'xv-author' });
	if (post.author.avatar) author.append(el('img', { class: 'xv-avatar', src: post.author.avatar, alt: '', width: '40', height: '40' }));
	author.append(el('div', {}, el('div', { class: 'xv-name', text: post.author.name }), el('div', { class: 'xv-handle', text: `@${post.author.handle}` })));
	card.append(author);

	if (post.text) card.append(el('div', { class: 'xv-text', text: post.text }));

	const metrics = el('ul', { class: 'xv-metrics', 'aria-label': 'Post engagement' });
	for (const item of [
		metricItem('likes', post.metrics.likes),
		metricItem('replies', post.metrics.replies),
		metricItem('reposts', post.metrics.reposts),
		metricItem('quotes', post.metrics.quotes),
		metricItem('views', post.metrics.views),
	]) if (item) metrics.append(item);
	card.append(metrics);

	const list = el('ul', { class: 'xv-list' });
	for (const v of videos) {
		const href = `/api/x-video/download?url=${encodeURIComponent(v.url)}&handle=${encodeURIComponent(post.author.handle)}&id=${encodeURIComponent(post.id)}`;
		list.append(
			el(
				'li',
				{ class: 'xv-row' },
				el('span', { class: 'xv-q', text: v.quality }),
				el('span', { class: 'xv-meta', text: [v.width && v.height ? `${v.width} x ${v.height}` : '', formatBytesEstimate(v, durationMs)].filter(Boolean).join(' · ') }),
				el('a', { class: 'xv-dl', href, download: '', 'aria-label': `Download ${v.quality} video` , text: 'Download' }),
			),
		);
	}
	card.append(list);

	statusEl.replaceChildren();
	result.replaceChildren(card);
}

async function extract(url) {
	button.disabled = true;
	button.textContent = 'Reading post...';
	showLoading();
	try {
		const res = await fetch('/api/x-video/extract', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ url }),
		});
		const data = await res.json().catch(() => null);
		if (!res.ok || !data?.videos?.length) {
			const titles = { invalid_url: 'That is not an X post link', post_unavailable: 'Post unavailable', no_video: 'No video in this post', upstream_unreachable: 'X did not answer' };
			const hint = { invalid_url: ' Copy the link from the post, for example https://x.com/user/status/123.', post_unavailable: '', no_video: '', upstream_unreachable: '' };
			showError(titles[data?.error] || 'Something went wrong', `${data?.message || `The request failed (HTTP ${res.status}). Try again.`}${hint[data?.error] || ''}`);
			return;
		}
		render(data);
	} catch {
		showError('Network problem', 'Could not reach three.ws. Check your connection and try again.');
	} finally {
		button.disabled = false;
		button.textContent = 'Get video';
	}
}

form.addEventListener('submit', (e) => {
	e.preventDefault();
	const url = input.value.trim();
	if (!url) {
		showError('Paste a link first', 'Copy the link of an X post that has a video and paste it above.');
		input.focus();
		return;
	}
	const u = new URL(location.href);
	u.searchParams.set('url', url);
	history.replaceState(null, '', u);
	extract(url);
});

const preset = new URLSearchParams(location.search).get('url');
if (preset) {
	input.value = preset;
	extract(preset);
}
