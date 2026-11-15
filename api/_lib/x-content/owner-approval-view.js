// How an X post approval reads in the inbox (api/_lib/approvals.js): the
// confirmation table and the post preview. Kept apart from owner-approval.js so
// the approvals library can render a post without loading the review stack.

export const X_POST_ACTION = 'x_post_publish';
export const X_ACCOUNT = '@trythreews';

// The confirmation table: the account, every post in full, the media, and
// when it may go out. Rendered by the approval page, the email, and chat.
const pollLength = (minutes) => (Number(minutes) < 120 ? `${Number(minutes)} min` : `${Math.round(Number(minutes) / 60)} h`);

export function xPostTable(row) {
	const p = row.payload || {};
	const posts = Array.isArray(p.posts) ? p.posts : [];
	const rows = [{ key: 'account', label: 'Account', value: X_ACCOUNT }];
	if (p.article_title) rows.push({ key: 'article', label: 'Article', value: p.article_title });
	posts.forEach((post, index) => {
		const key = index === 0 ? 'post' : `reply-${index}`;
		rows.push({ key, label: index === 0 ? (posts.length > 1 ? 'Post 1' : 'Post') : `Post ${index + 1}`, value: post.text || '(media only)' });
	});
	if (p.poll?.options?.length) rows.push({ key: 'poll', label: 'Poll', value: `${p.poll.options.join(' / ')} (${pollLength(p.poll.durationMinutes)})` });
	const media = posts.flatMap((post) => post.media || []);
	const counts = {};
	for (const m of media) counts[m.type || 'image'] = (counts[m.type || 'image'] || 0) + 1;
	const named = Object.entries(counts).map(([type, n]) => `${n} ${type}${n > 1 ? 's' : ''}`).join(', ');
	rows.push({ key: 'media', label: 'Media', value: media.length ? `${named}: ${media.map((m) => m.alt || m.path).join('; ')}` : 'None' });
	rows.push({ key: 'when', label: 'Goes out', value: p.not_before ? `In priority order, not before ${String(p.not_before).slice(0, 16).replace('T', ' ')} UTC` : 'In priority order at the next open slot' });
	return rows;
}

// What the approval page draws as a post preview. Media is addressed by
// position; the page loads each one through /api/approvals/:id?media=<n>,
// which serves the reviewed bytes.
export function previewOf(row) {
	const p = row.payload || {};
	let index = 0;
	return {
		account: X_ACCOUNT,
		article_title: p.article_title || null,
		poll: p.poll || null,
		posts: (p.posts || []).map((post) => ({ text: post.text || '', media: (post.media || []).map((m) => ({ index: index++, alt: m.alt || '', type: m.type || 'image' })) })),
	};
}

// The nth media entry of a request, in thread order.
export function mediaAt(row, index) {
	const all = (row.payload?.posts || []).flatMap((post) => post.media || []);
	return Number.isInteger(index) && index >= 0 ? all[index] || null : null;
}
