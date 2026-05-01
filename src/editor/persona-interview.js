// Step-through persona interview: 5 questions → POST /api/agents/:id/persona/extract

const QUESTIONS = [
	'How would your closest friend describe the way you communicate?',
	'What topic could you talk about for hours without getting bored?',
	'When someone misunderstands you, what do you usually say to clarify?',
	'Describe your sense of humor in two sentences.',
	"What's something people always get wrong about you?",
];

export class PersonaInterview {
	constructor(containerEl, { agentId, onComplete }) {
		this._container = containerEl;
		this._agentId = agentId;
		this._onComplete = onComplete;
		this._step = 0;
		this._answers = Array(QUESTIONS.length).fill('');
		this._listeners = [];
	}

	mount() {
		this._render();
	}

	destroy() {
		for (const [el, type, fn] of this._listeners) el.removeEventListener(type, fn);
		this._listeners = [];
		this._container.innerHTML = '';
	}

	_on(el, type, fn) {
		el.addEventListener(type, fn);
		this._listeners.push([el, type, fn]);
	}

	_render() {
		const step = this._step;
		const isLast = step === QUESTIONS.length - 1;
		const answer = this._answers[step];
		const remaining = 1000 - answer.length;

		this._container.innerHTML = `
			<div class="persona-interview">
				<div class="pi-progress">${step + 1} / ${QUESTIONS.length}</div>
				<p class="pi-question">${QUESTIONS[step]}</p>
				<textarea class="pi-textarea" rows="4" maxlength="1000" placeholder="Your answer…">${this._escHtml(answer)}</textarea>
				<div class="pi-meta">
					<span class="pi-counter">${remaining} chars left</span>
					<button class="pi-next" ${answer.trim().length < 5 ? 'disabled' : ''}>${isLast ? 'Finish' : 'Next'}</button>
				</div>
			</div>
		`;

		const ta = this._container.querySelector('.pi-textarea');
		const btn = this._container.querySelector('.pi-next');
		const counter = this._container.querySelector('.pi-counter');

		this._on(ta, 'input', () => {
			this._answers[step] = ta.value;
			const rem = 1000 - ta.value.length;
			counter.textContent = `${rem} chars left`;
			btn.disabled = ta.value.trim().length < 5;
		});

		this._on(btn, 'click', () => {
			if (isLast) {
				this._submit();
			} else {
				this._step++;
				this._render();
			}
		});
	}

	async _submit() {
		this._container.innerHTML = `
			<div class="persona-interview pi-loading">
				<p>Extracting persona…</p>
			</div>
		`;

		let result;
		try {
			const resp = await fetch(`/api/agents/${this._agentId}/persona/extract`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ answers: this._answers }),
			});
			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.error_description || `HTTP ${resp.status}`);
			}
			result = await resp.json();
		} catch (err) {
			this._container.innerHTML = `
				<div class="persona-interview pi-error">
					<p>Extraction failed: ${this._escHtml(err.message)}</p>
					<button class="pi-retry">Try again</button>
				</div>
			`;
			const retry = this._container.querySelector('.pi-retry');
			this._on(retry, 'click', () => {
				this._step = 0;
				this._answers = Array(QUESTIONS.length).fill('');
				this._render();
			});
			return;
		}

		const tags = (result.tone_tags || [])
			.map((t) => `<span class="pi-tag">${this._escHtml(t)}</span>`)
			.join('');

		this._container.innerHTML = `
			<div class="persona-interview pi-done">
				<p>Persona extracted ✓</p>
				<div class="pi-tags">${tags}</div>
			</div>
		`;

		this._onComplete?.({ tone_tags: result.tone_tags, extracted_at: result.extracted_at });
	}

	_escHtml(str) {
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}
}
