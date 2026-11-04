// NVIDIA Inception member perk: the application card on /nvidia.
//
// Renders one of: signed-out prompt, application form, pending, approved, or
// rejected (with the reviewer's note and a form to reapply). All state comes from
// /api/inception/apply; nothing here is a placeholder.

const root = document.getElementById('perk-root');
const PROGRAM = root?.dataset.program || 'nvidia-inception';
let meta = { shoutout_draft: null, program: null };

const FIELDS = [
	{ name: 'company', label: 'Company', type: 'text', autocomplete: 'organization', required: true },
	{ name: 'website', label: 'Company website', type: 'text', autocomplete: 'url', required: true, placeholder: 'yourstartup.com' },
	{ name: 'contact_email', label: 'Contact email', type: 'email', autocomplete: 'email', required: true },
	{
		name: 'inception_ref',
		label: 'Inception profile or member ID',
		type: 'text',
		hint: 'Optional, but it is the fastest way for us to verify your membership.',
	},
	{
		name: 'use_case',
		label: 'What will you generate?',
		type: 'textarea',
		required: true,
		hint: 'A sentence or two: the kind of models and where they will be used.',
	},
];

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === false || value == null) continue;
		if (key === 'text') node.textContent = value;
		else node.setAttribute(key, value === true ? '' : value);
	}
	for (const child of children) node.append(child);
	return node;
}

function paragraph(...parts) {
	return el('p', {}, ...parts);
}

function link(href, text, cls = 'btn btn-primary') {
	return el('a', { href, class: cls, text });
}

function render(...nodes) {
	root.replaceChildren(...nodes);
}

function banner(kind, text) {
	return el('div', { class: `perk-banner ${kind}`, role: kind === 'bad' ? 'alert' : 'status', text });
}

async function api(init, path = `/api/inception/apply?program=${encodeURIComponent(PROGRAM)}`) {
	try {
		return await fetch(path, { credentials: 'include', ...init });
	} catch {
		throw new Error(
			navigator.onLine === false
				? 'You appear to be offline. Reconnect, then try again.'
				: 'We could not reach three.ws. Check your connection, then try again.',
		);
	}
}

function showSignedOut() {
	render(
		paragraph(
			el('strong', { text: 'Sign in to apply. ' }),
			'The credit is granted to your three.ws account, so we need to know which one.',
		),
		link('/login?next=/nvidia%23inception-perk', 'Sign in to apply'),
	);
}

function showPending(app) {
	render(
		paragraph(
			el('strong', { text: 'Application received for ' + app.company + '. ' }),
			'A person reviews each one, usually within a few days. This page shows the result as soon as it is decided, so you can come back and check.',
		),
	);
}

function usd(n) {
	return `$${Number(n).toFixed(2)}`;
}

function showApproved(app) {
	const bonus = meta.program?.shoutout_bonus_usd;
	const sh = app.shoutout || { status: 'none' };
	const granted = app.grant_usd == null ? '' : ` ${usd(app.grant_usd)} of credit is in your balance.`;
	const nodes = [
		paragraph(
			el('strong', { text: 'Approved.' }),
			granted,
			app.reviewer_note ? ` Note from the reviewer: ${app.reviewer_note}` : '',
		),
		el('div', { class: 'cta-row', style: 'margin-bottom:24px' }, link('/forge', 'Generate a model'), link('/credits', 'View balance', 'btn btn-sec')),
	];
	if (sh.status === 'approved') {
		nodes.push(banner('good', `Shoutout verified, thank you. ${usd(sh.bonus_usd)} bonus credit added.`));
	} else if (sh.status === 'submitted') {
		nodes.push(banner('good', 'Your post is queued for review. The bonus lands in your balance once we confirm it is live.'));
	} else if (bonus) {
		nodes.push(shoutoutForm(sh, bonus));
	}
	render(...nodes);
}

function shoutoutForm(sh, bonus) {
	const draft = meta.shoutout_draft;
	const form = el('form', { class: 'perk-form', novalidate: true });
	const intro = el(
		'p',
		{},
		el('strong', { text: `Earn ${usd(bonus)} more. ` }),
		'Post about what you made on X or LinkedIn, then paste the link. We check that it is public and add the credit.',
	);
	const compose = draft
		? el('a', { href: draft.intent_url, target: '_blank', rel: 'noopener noreferrer', class: 'btn btn-sec', text: 'Write the post on X' })
		: '';
	const label = el(
		'label',
		{ for: 'perk-shout-url' },
		'Link to your public post',
		el('input', { id: 'perk-shout-url', name: 'url', type: 'url', required: true, placeholder: 'https://x.com/you/status/123456789', 'aria-describedby': 'perk-shout-err' }),
		el('span', { class: 'err', id: 'perk-shout-err' }),
	);
	const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Submit the post' });
	if (sh.status === 'rejected' && sh.note) form.append(banner('bad', `Your last link was not accepted: ${sh.note}`));
	form.append(label, el('div', { class: 'cta-row', style: 'margin-bottom:0' }, submit, compose));
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const err = form.querySelector('#perk-shout-err');
		const input = form.elements.url;
		err.textContent = '';
		input.removeAttribute('aria-invalid');
		submit.disabled = true;
		submit.textContent = 'Sending...';
		try {
			const res = await api(
				{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ program: PROGRAM, url: input.value }) },
				'/api/inception/shoutout',
			);
			const data = await res.json().catch(() => ({}));
			if (res.status === 401) return showSignedOut();
			if (!res.ok) {
				err.textContent = data.error_description || 'Something went wrong. Try again in a minute.';
				input.setAttribute('aria-invalid', 'true');
				input.focus();
				return;
			}
			load();
		} catch (e) {
			err.textContent = e.message;
		} finally {
			submit.disabled = false;
			submit.textContent = 'Submit the post';
		}
	});
	return el('div', { class: 'perk-shout' }, intro, form);
}

function field(def) {
	const id = `perk-${def.name}`;
	const control =
		def.type === 'textarea'
			? el('textarea', { id, name: def.name, rows: '4', required: def.required, maxlength: '1000', 'aria-describedby': `${id}-err` })
			: el('input', {
					id,
					name: def.name,
					type: def.type,
					autocomplete: def.autocomplete,
					required: def.required,
					placeholder: def.placeholder,
					'aria-describedby': `${id}-err`,
				});
	return el(
		'label',
		{ for: id },
		def.label,
		def.hint ? el('span', { class: 'hint', text: def.hint }) : '',
		control,
		el('span', { class: 'err', id: `${id}-err` }),
	);
}

function showForm({ intro, notice } = {}) {
	const form = el('form', { class: 'perk-form', novalidate: true });
	for (const def of FIELDS) form.append(field(def));
	const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Apply for the credit' });
	form.append(submit);

	function setErrors(fields = {}) {
		for (const def of FIELDS) {
			const input = form.elements[def.name];
			const message = fields[def.name] || '';
			form.querySelector(`#perk-${def.name}-err`).textContent = message;
			if (message) input.setAttribute('aria-invalid', 'true');
			else input.removeAttribute('aria-invalid');
		}
		const firstBad = FIELDS.find((def) => fields[def.name]);
		if (firstBad) form.elements[firstBad.name].focus();
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		setErrors();
		const body = Object.fromEntries(FIELDS.map((def) => [def.name, form.elements[def.name].value]));
		body.program = PROGRAM;
		submit.disabled = true;
		submit.textContent = 'Sending...';
		try {
			const res = await api({
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = await res.json().catch(() => ({}));
			if (res.status === 401) return showSignedOut();
			if (res.status === 422) {
				setErrors(data.fields || data.error?.fields || {});
				return;
			}
			if (res.status === 409) return load();
			if (res.status === 400) throw new Error(data.error_description || 'This program is not available.');
			if (!res.ok) throw new Error(data.error_description || data.message || 'Something went wrong on our side. Try again in a minute.');
			showPending(data.application);
		} catch (err) {
			form.prepend(banner('bad', err.message));
		} finally {
			submit.disabled = false;
			submit.textContent = 'Apply for the credit';
		}
	});

	render(...(notice ? [notice] : []), ...(intro ? [paragraph(intro)] : []), form);
}

async function load() {
	try {
		const res = await api({ method: 'GET' });
		if (res.status === 401) return showSignedOut();
		if (!res.ok) throw new Error('We could not load your application status. Refresh to try again.');
		const data = await res.json();
		meta = { shoutout_draft: data.shoutout_draft, program: data.program };
		const application = data.application;
		if (!application) return showForm();
		if (application.status === 'pending') return showPending(application);
		if (application.status === 'approved') return showApproved(application);
		return showForm({
			notice: banner(
				'bad',
				`Your last application was not approved${application.reviewer_note ? `: ${application.reviewer_note}` : '.'} Fix that and apply again.`,
			),
		});
	} catch (err) {
		render(banner('bad', err.message), el('button', { type: 'button', class: 'btn btn-sec', text: 'Try again', id: 'perk-retry' }));
		document.getElementById('perk-retry').addEventListener('click', load);
	}
}

if (root) load();
