/**
 * A property pane field that searches three.ws as the site owner types.
 *
 * Accessible combobox (input + listbox, arrow keys, Enter, Escape), debounced
 * real API calls with the previous request aborted, and designed loading,
 * empty and error states. Framework-free so the web parts and the Viva
 * Connections card property pane share it.
 */
import { IPropertyPaneCustomFieldProps, IPropertyPaneField, PropertyPaneFieldType } from '@microsoft/sp-property-pane';
import styles from './SearchPicker.module.scss';
import { debouncedSearch } from './threeWsApi';

export interface PickerItem {
	value: string;
	title: string;
	subtitle: string;
	thumbnailUrl: string;
}

export interface SearchPickerProps {
	key: string;
	label: string;
	placeholder: string;
	/** Label for the current value, shown above the search box. */
	selectedLabel: string;
	selectedValue: string;
	search: (query: string, signal: AbortSignal) => Promise<PickerItem[]>;
	/** Turns a pasted id or URL into a directly selectable item. */
	resolveTyped?: (query: string) => PickerItem | undefined;
	copy: {
		searching: string;
		empty: string;
		noneSelected: string;
		selected: string;
		error: string;
	};
}

export interface PickerHandle {
	update(value: string, label: string): void;
	dispose(): void;
}

let instance = 0;

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, textContent?: string): HTMLElementTagNameMap[K] {
	const node = doc.createElement(tag);
	if (className) node.className = className;
	if (textContent !== undefined) node.textContent = textContent;
	return node;
}

export function renderSearchPicker(
	host: HTMLElement,
	props: SearchPickerProps,
	onSelect: (item: PickerItem) => void,
): PickerHandle {
	const doc = host.ownerDocument;
	const id = `tw-picker-${++instance}`;
	host.replaceChildren();

	const root = el(doc, 'div', styles.picker);
	const label = el(doc, 'label', styles.label, props.label);
	label.htmlFor = `${id}-input`;

	const current = el(doc, 'p', styles.current);
	const setCurrent = (text: string): void => {
		current.replaceChildren();
		if (!text) {
			current.appendChild(el(doc, 'span', styles.muted, props.copy.noneSelected));
			return;
		}
		current.appendChild(el(doc, 'span', styles.muted, `${props.copy.selected}: `));
		current.appendChild(el(doc, 'strong', undefined, text));
	};
	setCurrent(props.selectedLabel || props.selectedValue);

	const input = el(doc, 'input', styles.input);
	input.id = `${id}-input`;
	input.type = 'search';
	input.autocomplete = 'off';
	input.spellcheck = false;
	input.placeholder = props.placeholder;
	input.setAttribute('role', 'combobox');
	input.setAttribute('aria-autocomplete', 'list');
	input.setAttribute('aria-expanded', 'false');
	input.setAttribute('aria-controls', `${id}-list`);

	const status = el(doc, 'div', styles.status);
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');

	const list = el(doc, 'ul', styles.list);
	list.id = `${id}-list`;
	list.setAttribute('role', 'listbox');
	list.setAttribute('aria-label', props.label);

	root.append(label, current, input, status, list);
	host.appendChild(root);

	let items: PickerItem[] = [];
	let active = -1;
	let selected = props.selectedValue;

	const setActive = (index: number): void => {
		active = index;
		Array.from(list.children).forEach((node, i) => {
			node.classList.toggle(styles.active, i === index);
		});
		if (index >= 0 && list.children[index]) {
			input.setAttribute('aria-activedescendant', list.children[index].id);
			(list.children[index] as HTMLElement).scrollIntoView({ block: 'nearest' });
		} else {
			input.removeAttribute('aria-activedescendant');
		}
	};

	function renderItems(next: PickerItem[]): void {
		items = next;
		list.replaceChildren();
		next.forEach((item, i) => {
			const li = el(doc, 'li', styles.option);
			li.id = `${id}-opt-${i}`;
			li.setAttribute('role', 'option');
			li.setAttribute('aria-selected', String(item.value === selected));
			if (item.value === selected) li.classList.add(styles.chosen);
			const thumb = el(doc, 'span', styles.thumb);
			if (item.thumbnailUrl) {
				const img = el(doc, 'img');
				img.src = item.thumbnailUrl;
				img.alt = '';
				img.loading = 'lazy';
				img.decoding = 'async';
				img.addEventListener('error', () => img.remove(), { once: true });
				thumb.appendChild(img);
			}
			const textWrap = el(doc, 'span', styles.text);
			textWrap.appendChild(el(doc, 'span', styles.title, item.title));
			if (item.subtitle) textWrap.appendChild(el(doc, 'span', styles.subtitle, item.subtitle));
			li.append(thumb, textWrap);
			li.addEventListener('mousedown', (e) => e.preventDefault());
			li.addEventListener('click', () => choose(item));
			list.appendChild(li);
		});
		input.setAttribute('aria-expanded', String(next.length > 0));
		setActive(-1);
	}

	function choose(item: PickerItem): void {
		selected = item.value;
		setCurrent(item.title);
		renderItems(items);
		onSelect(item);
	}

	const setStatus = (text: string, kind: 'info' | 'error' | 'loading'): void => {
		status.textContent = text;
		status.className = `${styles.status} ${kind === 'error' ? styles.statusError : ''} ${kind === 'loading' ? styles.statusLoading : ''}`;
	};

	const run = debouncedSearch(
		(query, signal) => props.search(query, signal),
		({ query, value, error }) => {
			if (error) {
				renderItems([]);
				setStatus(`${props.copy.error} ${error.message}`, 'error');
				return;
			}
			const typed = props.resolveTyped ? props.resolveTyped(query) : undefined;
			const merged = typed ? [typed, ...(value || []).filter((i) => i.value !== typed.value)] : value || [];
			renderItems(merged);
			setStatus(merged.length ? '' : props.copy.empty, 'info');
		},
		300,
	);

	const search = (): void => {
		setStatus(props.copy.searching, 'loading');
		run(input.value);
	};

	input.addEventListener('input', search);
	input.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'ArrowDown' && items.length) {
			e.preventDefault();
			setActive(Math.min(active + 1, items.length - 1));
		} else if (e.key === 'ArrowUp' && items.length) {
			e.preventDefault();
			setActive(Math.max(active - 1, 0));
		} else if (e.key === 'Enter' && active >= 0 && items[active]) {
			e.preventDefault();
			choose(items[active]);
		} else if (e.key === 'Escape' && items.length) {
			e.preventDefault();
			renderItems([]);
		}
	});

	// First open lists the newest results, so there is something to pick before typing.
	search();

	return {
		update: (value: string, labelText: string): void => {
			if (value === selected) return;
			selected = value;
			setCurrent(labelText || value);
			renderItems(items);
		},
		dispose: (): void => {
			run.cancel();
			host.replaceChildren();
		},
	};
}

// Module scope: the pane builds a new field object on every refresh but keeps
// the same host element, so the live picker is looked up by element.
const handles = new WeakMap<HTMLElement, PickerHandle>();

/** Wraps renderSearchPicker as an SPFx property pane custom field. */
export function PropertyPaneSearchPicker(
	targetProperty: string,
	props: SearchPickerProps,
	onSelect?: (item: PickerItem) => void,
): IPropertyPaneField<IPropertyPaneCustomFieldProps> {
	return {
		type: PropertyPaneFieldType.Custom,
		targetProperty,
		properties: {
			key: props.key,
			onRender: (elem: HTMLElement, _ctx?: unknown, changeCallback?: (targetProperty?: string, newValue?: unknown) => void): void => {
				// The pane calls onRender again after every property change; keep the
				// owner's query and results and only refresh the selection.
				const existing = handles.get(elem);
				if (existing && elem.firstChild) {
					existing.update(props.selectedValue, props.selectedLabel);
					return;
				}
				handles.set(
					elem,
					renderSearchPicker(elem, props, (item) => {
						if (onSelect) onSelect(item);
						if (changeCallback) changeCallback(targetProperty, item.value);
					}),
				);
			},
			onDispose: (elem: HTMLElement): void => {
				handles.get(elem)?.dispose();
				handles.delete(elem);
			},
		},
	};
}
