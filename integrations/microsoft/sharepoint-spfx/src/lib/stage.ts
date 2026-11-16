/**
 * The rendering surface both web parts share. It owns every state a reader
 * or site owner can see: not set up, loading (skeleton), poster with a
 * "View in 3D" button (autoplay off), live 3D, and error with a retry.
 *
 * It only ever touches the element it was given (SharePoint's domElement),
 * never the rest of the page, and builds DOM with textContent so nothing
 * returned by the API is parsed as HTML.
 */
import styles from './Stage.module.scss';
import { loadAgentRuntime } from './runtime';

export type Background = 'transparent' | 'dark' | 'light';
export type Framing = 'full' | 'portrait';

export interface StageSubject {
	/** <agent-3d agent-id>: a three.ws agent. */
	agentId?: string;
	/** <agent-3d body>: a bare GLB rendered with the three.ws viewer. */
	modelUrl?: string;
	name: string;
	posterUrl: string;
	pageUrl: string;
}

export interface StageOptions {
	title: string;
	height: number;
	background: Background;
	framing: Framing;
	autoplay: boolean;
	chat: boolean;
	namePlate: boolean;
}

export interface StageCopy {
	setupHeading: string;
	setupBody: string;
	setupButton: string;
	notSetUp: string;
	viewIn3d: string;
	loading: string;
	retry: string;
	openOnThreeWs: string;
}

export const MIN_HEIGHT = 240;
export const MAX_HEIGHT = 1200;

export function clampHeight(value: unknown): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return 520;
	return Math.min(Math.max(Math.round(n), MIN_HEIGHT), MAX_HEIGHT);
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, textContent?: string): HTMLElementTagNameMap[K] {
	const node = doc.createElement(tag);
	if (className) node.className = className;
	if (textContent !== undefined) node.textContent = textContent;
	return node;
}

export class ThreeWsStage {
	private readonly host: HTMLElement;
	private readonly copy: StageCopy;
	private generation = 0;

	public constructor(host: HTMLElement, copy: StageCopy) {
		this.host = host;
		this.copy = copy;
	}

	private get doc(): Document {
		return this.host.ownerDocument;
	}

	private frame(options: StageOptions): HTMLElement {
		this.generation++;
		this.host.replaceChildren();
		const section = el(this.doc, 'section', `${styles.stage} ${styles[`bg_${options.background}`] || ''}`);
		section.setAttribute('aria-label', options.title);
		section.style.setProperty('--tw-stage-height', `${clampHeight(options.height)}px`);
		this.host.appendChild(section);
		return section;
	}

	/** Not configured yet. Site owners get a call to action; readers get a quiet note. */
	public renderSetup(options: StageOptions, isEditMode: boolean, onConfigure: () => void): void {
		const section = this.frame(options);
		section.classList.add(styles.setup);
		if (!isEditMode) {
			section.appendChild(el(this.doc, 'p', styles.muted, this.copy.notSetUp));
			return;
		}
		section.appendChild(el(this.doc, 'h3', styles.heading, this.copy.setupHeading));
		section.appendChild(el(this.doc, 'p', styles.muted, this.copy.setupBody));
		const button = el(this.doc, 'button', styles.primary, this.copy.setupButton);
		button.type = 'button';
		button.addEventListener('click', onConfigure);
		section.appendChild(button);
	}

	/** Skeleton while the agent or model record is being fetched. */
	public renderLoading(options: StageOptions): void {
		const section = this.frame(options);
		const skeleton = el(this.doc, 'div', styles.skeleton);
		skeleton.setAttribute('role', 'status');
		skeleton.setAttribute('aria-live', 'polite');
		skeleton.appendChild(el(this.doc, 'span', styles.srOnly, this.copy.loading));
		section.appendChild(skeleton);
	}

	public renderError(options: StageOptions, message: string, onRetry: () => void, pageUrl?: string): void {
		const section = this.frame(options);
		section.classList.add(styles.setup);
		const box = el(this.doc, 'div', styles.error);
		box.setAttribute('role', 'alert');
		box.appendChild(el(this.doc, 'p', undefined, message));
		const actions = el(this.doc, 'div', styles.actions);
		const retry = el(this.doc, 'button', styles.primary, this.copy.retry);
		retry.type = 'button';
		retry.addEventListener('click', onRetry);
		actions.appendChild(retry);
		if (pageUrl) actions.appendChild(this.pageLink(pageUrl));
		box.appendChild(actions);
		section.appendChild(box);
	}

	private pageLink(pageUrl: string): HTMLAnchorElement {
		const link = el(this.doc, 'a', styles.secondary, this.copy.openOnThreeWs);
		link.href = pageUrl;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		return link;
	}

	/**
	 * Autoplay on: load the runtime and mount immediately. Autoplay off: show
	 * the poster and a "View in 3D" button, so a page with several web parts
	 * downloads nothing heavy until a reader asks for it.
	 */
	public renderSubject(options: StageOptions, subject: StageSubject, onError: (message: string) => void): void {
		if (options.autoplay) {
			this.mount(options, subject, onError);
			return;
		}
		const section = this.frame(options);
		const poster = el(this.doc, 'div', styles.poster);
		if (subject.posterUrl) {
			const img = el(this.doc, 'img');
			img.src = subject.posterUrl;
			img.alt = '';
			img.decoding = 'async';
			img.loading = 'lazy';
			poster.appendChild(img);
		}
		const button = el(this.doc, 'button', `${styles.primary} ${styles.play}`, this.copy.viewIn3d);
		button.type = 'button';
		button.setAttribute('aria-label', `${this.copy.viewIn3d}: ${subject.name}`);
		button.addEventListener('click', () => this.mount(options, subject, onError));
		poster.appendChild(button);
		section.appendChild(poster);
	}

	private mount(options: StageOptions, subject: StageSubject, onError: (message: string) => void): void {
		const section = this.frame(options);
		const generation = this.generation;
		const skeleton = el(this.doc, 'div', `${styles.skeleton} ${styles.overlay}`);
		skeleton.setAttribute('role', 'status');
		skeleton.setAttribute('aria-live', 'polite');
		skeleton.appendChild(el(this.doc, 'span', styles.srOnly, this.copy.loading));
		section.appendChild(skeleton);

		loadAgentRuntime(this.doc).then(
			() => {
				if (generation !== this.generation) return;
				const node = this.doc.createElement('agent-3d');
				if (subject.agentId) node.setAttribute('agent-id', subject.agentId);
				else if (subject.modelUrl) node.setAttribute('body', subject.modelUrl);
				node.setAttribute('background', options.background);
				node.setAttribute('framing', options.framing);
				node.setAttribute('chat', options.chat && subject.agentId ? 'on' : 'off');
				node.setAttribute('name-plate', options.namePlate ? 'on' : 'off');
				if (subject.posterUrl) node.setAttribute('poster', subject.posterUrl);
				node.setAttribute('width', '100%');
				node.setAttribute('height', `${clampHeight(options.height)}px`);
				node.className = styles.agent;
				node.addEventListener('agent:ready', () => skeleton.remove(), { once: true });
				node.addEventListener('agent:error', (event: Event) => {
					if (generation !== this.generation) return;
					const detail = (event as CustomEvent<{ phase?: string; error?: { message?: string } }>).detail;
					// A failed chat message is shown inside the element itself; only a
					// boot or embed-policy failure leaves nothing to look at.
					if (detail?.phase !== 'boot' && detail?.phase !== 'policy') return;
					skeleton.remove();
					onError(detail?.error?.message ? `The 3D view could not load: ${detail.error.message}` : 'The 3D view could not load.');
				});
				section.appendChild(node);
			},
			(err: Error) => {
				if (generation !== this.generation) return;
				onError(err.message);
			},
		);
	}

	public dispose(): void {
		this.generation++;
		this.host.replaceChildren();
	}
}
