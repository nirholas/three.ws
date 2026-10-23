// "Suggested skills" on the agent dashboard: skills an agent drafted for itself
// from runs that verifiably worked (api/_lib/skill-candidates.js). The owner
// reads the bundle and the evidence run, then installs it on that agent only,
// publishes it to the marketplace, or dismisses it. Nothing installs or
// publishes without one of those clicks.
//
// All text reaches the DOM through textContent, never innerHTML: a draft is
// model-written and its evidence comes from tool arguments.

const SIGNAL_LABEL = {
	multi_tool_turn: 'Multi-tool run, no errors',
	labor_escrow_passed: 'Labor job passed escrow',
	profitable_trade: 'Closed profitable trade',
};

const STATUS_LABEL = { draft: 'Ready to review', invalid: 'Failed validation', installed: 'Installed', dismissed: 'Dismissed' };

function h(tag, attrs = {}, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	return el;
}

const pre = (text) => h('pre', { class: 'sugg-pre', tabindex: '0' }, text);

function stepsList(steps) {
	return h(
		'ol',
		{ class: 'sugg-steps' },
		steps.map((s) => h('li', {}, h('code', {}, s.tool), ' ', h('span', { class: 'muted' }, JSON.stringify(s.args)))),
	);
}

function bundleFiles(bundle) {
	const files = [
		['manifest.json', JSON.stringify(bundle.manifest, null, 2)],
		['SKILL.md', bundle.skill_md],
		['tools.json', JSON.stringify(bundle.tools, null, 2)],
		['handlers.js', bundle.handlers_src],
	];
	return files.map(([name, body]) => h('details', { class: 'sugg-file' }, h('summary', {}, name), pre(body)));
}

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {Array<{id:string,name?:string}>} o.agents
 * @param {(method:string, path:string, body?:object) => Promise<any>} o.request  the dashboard's CSRF-aware fetch
 */
export async function mountSuggestedSkills(host, { agents, request }) {
	host.replaceChildren(h('div', { class: 'muted' }, 'Loading suggested skills…'));

	async function load() {
		const results = await Promise.allSettled(
			agents.slice(0, 24).map((a) => request('GET', `/api/agents/${encodeURIComponent(a.id)}/skill-candidates`).then((r) => ({ agent: a, list: r?.data?.candidates || [] }))),
		);
		const failed = results.filter((r) => r.status === 'rejected');
		const groups = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
		render(groups, failed.length);
	}

	async function act(agent, candidate, body, button) {
		const label = button.textContent;
		button.disabled = true;
		button.textContent = 'Working…';
		try {
			await request('POST', `/api/agents/${encodeURIComponent(agent.id)}/skill-candidates/${encodeURIComponent(candidate.id)}`, body);
			await load();
		} catch (err) {
			button.disabled = false;
			button.textContent = label;
			const slot = button.closest('.sugg-card')?.querySelector('.sugg-error');
			if (slot) slot.textContent = err?.message || 'That did not work. Try again.';
		}
	}

	function actionButton(agent, candidate, label, body, { primary = false, title = '' } = {}) {
		const btn = h('button', { type: 'button', class: primary ? 'btn-primary' : 'btn sec', title }, label);
		btn.addEventListener('click', () => act(agent, candidate, body, btn));
		return btn;
	}

	function revisionBlock(agent, candidate, revision) {
		return h(
			'div',
			{ class: 'sugg-revision' },
			h('strong', {}, revision.kind === 'repair' ? 'Proposed repair' : 'Proposed extension'),
			h('span', { class: 'muted' }, ` ${revision.from_version} to ${revision.to_version}`),
			h('p', { class: 'muted' }, revision.kind === 'repair'
				? 'The installed skill failed on a later run and the agent finished the job another way.'
				: 'A later run used this skill and then needed more tools to finish.'),
			pre(revision.diff || 'No file changes.'),
			h(
				'div',
				{ class: 'sugg-actions' },
				actionButton(agent, candidate, 'Accept revision', { action: 'accept_revision', revision_id: revision.id }, { primary: true }),
				actionButton(agent, candidate, 'Dismiss revision', { action: 'dismiss_revision', revision_id: revision.id }),
			),
		);
	}

	function card(agent, c) {
		const pending = (c.revisions || []).filter((r) => r.status === 'pending');
		const title = c.plan?.name || 'Draft needs another try';
		const actions = [];
		if (c.status === 'draft') {
			actions.push(actionButton(agent, c, 'Install on this agent', { action: 'accept' }, { primary: true, title: 'Installs on this agent only' }));
			actions.push(actionButton(agent, c, 'Publish to marketplace', { action: 'publish' }));
		}
		if (c.status === 'installed') {
			if (!c.published_skill_id) actions.push(actionButton(agent, c, 'Publish to marketplace', { action: 'publish' }));
			else actions.push(h('a', { class: 'btn sec', href: '/marketplace' }, 'On the marketplace'));
		}
		if (c.status === 'invalid') actions.push(actionButton(agent, c, 'Redraft', { action: 'redraft' }, { primary: true }));
		actions.push(actionButton(agent, c, c.status === 'installed' ? 'Uninstall' : 'Dismiss', { action: 'dismiss' }));

		return h(
			'article',
			{ class: 'card sugg-card', 'aria-label': `Suggested skill ${title}` },
			h(
				'header',
				{ class: 'sugg-head' },
				h('h3', {}, title),
				h('span', { class: `sugg-chip sugg-${c.status}` }, STATUS_LABEL[c.status] || c.status),
			),
			c.plan?.description ? h('p', {}, c.plan.description) : null,
			h('p', { class: 'muted' }, `${SIGNAL_LABEL[c.signal] || c.signal}. Goal: ${c.goal}`),
			c.validation_errors?.length ? h('ul', { class: 'sugg-errors' }, c.validation_errors.map((e) => h('li', {}, e))) : null,
			h('details', { class: 'sugg-evidence' }, h('summary', {}, `Evidence run (${c.steps.length} steps, argument values never stored)`), stepsList(c.steps)),
			c.bundle ? h('details', { class: 'sugg-bundle' }, h('summary', {}, 'View bundle'), bundleFiles(c.bundle)) : null,
			pending.map((r) => revisionBlock(agent, c, r)),
			h('p', { class: 'sugg-error', role: 'alert' }),
			h('div', { class: 'sugg-actions' }, actions),
		);
	}

	function render(groups, failedCount) {
		const sections = groups
			.map(({ agent, list }) => ({ agent, list: list.filter((c) => c.status !== 'dismissed') }))
			.filter(({ list }) => list.length);

		const body = [];
		if (failedCount) {
			body.push(h('p', { class: 'sugg-error', role: 'alert' }, `Could not load suggestions for ${failedCount} agent${failedCount === 1 ? '' : 's'}. Reload to retry.`));
		}
		if (!sections.length) {
			body.push(
				h(
					'div',
					{ class: 'muted sugg-empty' },
					'No suggestions yet. When an agent finishes a run that used several tools without an error, passes a labor-escrow job, or closes a profitable trade, it drafts a skill here for you to review.',
				),
			);
		}
		for (const { agent, list } of sections) {
			body.push(h('h3', { class: 'sugg-agent' }, agent.name || 'Agent'), h('div', { class: 'cards' }, list.map((c) => card(agent, c))));
		}
		host.replaceChildren(
			h('h2', {}, 'Suggested skills'),
			h('p', { class: 'sub' }, 'Skills your agents drafted from runs that worked. Nothing installs or publishes until you choose.'),
			...body,
		);
	}

	await load();
}
