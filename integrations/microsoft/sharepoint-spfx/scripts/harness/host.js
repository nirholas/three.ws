/**
 * A minimal stand-in for the SharePoint page host, just enough to run the
 * production bundles from the .sppkg unmodified:
 *
 *   - an AMD loader (the bundles call define([...deps], factory)),
 *   - the five framework modules they import, implemented from the public
 *     SPFx 1.24 contracts (enum values copied from the published typings),
 *   - a property pane renderer that drives getPropertyPaneConfiguration(),
 *     custom field onRender/onDispose and onPropertyPaneFieldChanged,
 *   - a dashboard card renderer and an Adaptive Card quick view rendered by
 *     the real adaptivecards + adaptivecards-templating libraries.
 *
 * It is not Microsoft's renderer, and layout and chrome are deliberately
 * plain. What it proves is that the shipped code mounts, talks to three.ws,
 * loads the runtime under SharePoint's Content Security Policy, and reaches
 * every state. Base classes are ES5 constructor functions because the
 * bundles subclass with tslib __extends (Base.call(this)), which an ES2015
 * class constructor would refuse.
 */
(function () {
	'use strict';

	var log = { violations: [], actions: [], cardViews: [] };
	document.addEventListener('securitypolicyviolation', function (e) {
		log.violations.push({ directive: e.effectiveDirective, blockedURI: e.blockedURI, disposition: e.disposition });
	});

	// AMD loader ---------------------------------------------------------------
	var modules = {};
	var defined = [];
	window.define = function (name, deps, factory) {
		if (typeof name !== 'string') {
			factory = deps;
			deps = name;
			name = undefined;
		}
		if (typeof deps === 'function') {
			factory = deps;
			deps = [];
		}
		defined.push({ name: name, deps: deps, factory: factory });
	};
	window.define.amd = {};

	var assetsPromise = fetch('/harness/assets.json').then(function (r) {
		return r.json();
	});

	function loadScript(src) {
		return new Promise(function (resolve, reject) {
			var s = document.createElement('script');
			s.src = src;
			s.onload = function () {
				resolve();
			};
			s.onerror = function () {
				reject(new Error('Could not load ' + src));
			};
			document.head.appendChild(s);
		});
	}

	function assetFor(prefix) {
		return assetsPromise.then(function (assets) {
			var file = assets.find(function (a) {
				return a.indexOf(prefix) === 0 && /\.js$/.test(a);
			});
			if (!file) throw new Error('No packaged asset starts with ' + prefix);
			return file;
		});
	}

	// Bundles load one at a time so each define() belongs to the script just loaded.
	var queue = Promise.resolve();
	function requireAsset(file) {
		var run = queue.then(function () {
			defined = [];
			return loadScript('/assets/' + file).then(function () {
				var entry = defined.pop();
				if (!entry) throw new Error(file + ' did not call define()');
				return entry;
			});
		});
		queue = run.catch(function () {});
		return run.then(function (entry) {
			return entry.deps.reduce(function (p, dep) {
				return p.then(function (list) {
					return resolveModule(dep).then(function (m) {
						return list.concat([m]);
					});
				});
			}, Promise.resolve([])).then(function (deps) {
				return entry.factory.apply(null, deps);
			});
		});
	}

	function resolveModule(name) {
		if (modules[name]) return Promise.resolve(modules[name]);
		if (/Strings$/.test(name)) {
			return assetFor(name + '_en-us_')
				.then(requireAsset)
				.then(function (m) {
					modules[name] = m;
					return m;
				});
		}
		return Promise.reject(new Error('The host has no module named ' + name));
	}

	// @microsoft/sp-core-library ----------------------------------------------
	var DisplayMode = { Read: 1, Edit: 2 };
	var Version = {
		parse: function (s) {
			return { toString: function () { return s; } };
		},
	};
	var SP_PROPERTY_PANE_ID = 'f9e737b7-f0df-4597-ba8c-3060f82380db';
	modules['@microsoft/sp-core-library'] = {
		DisplayMode: DisplayMode,
		Version: Version,
		// Async chunks ask the component loader for externals they import.
		_getAsyncComponentLoader: function () {
			return {
				loadComponentById: function (id) {
					if (id === SP_PROPERTY_PANE_ID) return Promise.resolve(modules['@microsoft/sp-property-pane']);
					return Promise.reject(new Error('The host cannot load component ' + id));
				},
			};
		},
	};

	// @microsoft/sp-property-pane ---------------------------------------------
	var FieldType = { Custom: 1, CheckBox: 2, TextField: 3, Toggle: 5, Dropdown: 6, Label: 7, Slider: 8, Heading: 9, ChoiceGroup: 10, Button: 11, HorizontalRule: 12, Link: 13 };
	function factory(type) {
		return function (targetProperty, properties) {
			return { type: type, targetProperty: targetProperty, properties: properties || {} };
		};
	}
	modules['@microsoft/sp-property-pane'] = {
		PropertyPaneFieldType: FieldType,
		PropertyPaneTextField: factory(FieldType.TextField),
		PropertyPaneToggle: factory(FieldType.Toggle),
		PropertyPaneDropdown: factory(FieldType.Dropdown),
		PropertyPaneSlider: factory(FieldType.Slider),
		PropertyPaneLink: factory(FieldType.Link),
		PropertyPaneLabel: factory(FieldType.Label),
	};

	// @microsoft/sp-component-base --------------------------------------------
	var THEMES = {
		neutral: null,
		soft: {
			palette: { themePrimary: '#0f6cbd' },
			semanticColors: { bodyText: '#242424', bodySubtext: '#616161', bodyBackground: '#ebf3fc', inputBorder: '#8a8886', primaryButtonBackground: '#0f6cbd', primaryButtonBackgroundHovered: '#115ea3', primaryButtonText: '#ffffff', focusBorder: '#0f6cbd', buttonBackgroundHovered: '#dbe9f8', link: '#115ea3' },
		},
		strong: {
			palette: { themePrimary: '#ffffff' },
			semanticColors: { bodyText: '#ffffff', bodySubtext: '#e1dfdd', bodyBackground: '#0f6cbd', inputBorder: '#ffffff', primaryButtonBackground: '#ffffff', primaryButtonBackgroundHovered: '#ebf3fc', primaryButtonText: '#0f6cbd', focusBorder: '#ffffff', buttonBackgroundHovered: '#115ea3', link: '#ffffff' },
		},
	};
	var themeState = { name: 'neutral', listeners: [] };
	var themeProvider = {
		tryGetTheme: function () {
			return THEMES[themeState.name] || undefined;
		},
		themeChangedEvent: {
			add: function (obj, fn) {
				themeState.listeners.push({ obj: obj, fn: fn });
			},
			remove: function (obj, fn) {
				themeState.listeners = themeState.listeners.filter(function (l) {
					return l.obj !== obj || l.fn !== fn;
				});
			},
		},
	};
	function ThemeProvider() {}
	ThemeProvider.serviceKey = { id: 'ThemeProvider' };
	modules['@microsoft/sp-component-base'] = { ThemeProvider: ThemeProvider };

	function makeContext(component) {
		return {
			serviceScope: {
				consume: function (key) {
					if (key === ThemeProvider.serviceKey) return themeProvider;
					throw new Error('The host has no service ' + (key && key.id));
				},
			},
			propertyPane: {
				open: function () {
					openPane(component);
				},
				refresh: function () {
					if (pane.component === component) renderPane();
				},
				isPropertyPaneOpen: function () {
					return pane.component === component;
				},
			},
		};
	}

	// @microsoft/sp-webpart-base ----------------------------------------------
	function BaseClientSideWebPart() {}
	Object.defineProperties(BaseClientSideWebPart.prototype, {
		domElement: { get: function () { return this.__host.dom; } },
		properties: { get: function () { return this.__host.properties; } },
		displayMode: { get: function () { return this.__host.displayMode; } },
		context: { get: function () { return this.__host.context; } },
		dataVersion: { get: function () { return Version.parse('1.0'); }, configurable: true },
		disableReactivePropertyChanges: { get: function () { return false; }, configurable: true },
	});
	BaseClientSideWebPart.prototype.onInit = function () { return Promise.resolve(); };
	BaseClientSideWebPart.prototype.onDispose = function () {};
	BaseClientSideWebPart.prototype.onThemeChanged = function () {};
	BaseClientSideWebPart.prototype.onPropertyPaneFieldChanged = function () {};
	BaseClientSideWebPart.prototype.getPropertyPaneConfiguration = function () { return { pages: [] }; };
	modules['@microsoft/sp-webpart-base'] = { BaseClientSideWebPart: BaseClientSideWebPart };

	// @microsoft/sp-adaptive-card-extension-base ------------------------------
	function navigator() {
		var views = {};
		return {
			register: function (id, make) { views[id] = make; },
			create: function (id) { return views[id] && views[id](); },
		};
	}
	function BaseAdaptiveCardExtension() {
		this.cardNavigator = navigator();
		this.quickViewNavigator = navigator();
	}
	Object.defineProperties(BaseAdaptiveCardExtension.prototype, {
		properties: { get: function () { return this.__host.properties; } },
		displayMode: { get: function () { return this.__host.displayMode; } },
		context: { get: function () { return this.__host.context; } },
	});
	BaseAdaptiveCardExtension.prototype.setState = function (partial) {
		this.state = Object.assign({}, this.state, partial);
		if (this.__host) renderCard(this);
	};
	BaseAdaptiveCardExtension.prototype.loadPropertyPaneResources = function () { return Promise.resolve(); };
	BaseAdaptiveCardExtension.prototype.onPropertyPaneFieldChanged = function () {};
	BaseAdaptiveCardExtension.prototype.getPropertyPaneConfiguration = function () { return { pages: [] }; };
	BaseAdaptiveCardExtension.prototype.onDispose = function () {};

	function BaseView() {}
	function bindView(view, ace) {
		Object.defineProperty(view, 'properties', { get: function () { return ace.properties; }, configurable: true });
		Object.defineProperty(view, 'state', { get: function () { return ace.state; }, configurable: true });
		return view;
	}
	BaseView.prototype.onAction = function () {};
	function cardView(kind) {
		return function (params) {
			return Object.assign({ cardViewType: kind }, params);
		};
	}
	modules['@microsoft/sp-adaptive-card-extension-base'] = {
		BaseAdaptiveCardExtension: BaseAdaptiveCardExtension,
		BaseComponentsCardView: BaseView,
		BaseAdaptiveCardQuickView: BaseView,
		BasicCardView: cardView('basic'),
		ImageCardView: cardView('image'),
	};

	// Page chrome ---------------------------------------------------------------
	function h(tag, attrs, children) {
		var node = document.createElement(tag);
		Object.keys(attrs || {}).forEach(function (k) {
			if (k === 'text') node.textContent = attrs[k];
			else if (k === 'className') node.className = attrs[k];
			else node.setAttribute(k, attrs[k]);
		});
		(children || []).forEach(function (c) {
			if (c) node.appendChild(c);
		});
		return node;
	}
	var section = document.getElementById('section');
	var mountPoint = document.getElementById('mount');
	var paneEl = document.getElementById('pane');
	var pane = { component: undefined, customHosts: {} };
	var current;

	function exportOf(mod) {
		return mod && mod.default ? mod.default : mod;
	}

	function setProperty(component, path, value) {
		var host = component.__host;
		var old = host.properties[path];
		host.properties[path] = value;
		component.onPropertyPaneFieldChanged(path, old, value);
		if (host.kind === 'webpart' && !component.disableReactivePropertyChanges) component.render();
		if (host.kind === 'card') renderCard(component);
		if (pane.component === component) renderPane();
	}

	// Property pane -------------------------------------------------------------
	function openPane(component) {
		var ready = component.__host.kind === 'card' ? component.loadPropertyPaneResources() : Promise.resolve();
		return ready.then(function () {
			pane.component = component;
			paneEl.hidden = false;
			document.body.classList.add('pane-open');
			renderPane();
		});
	}

	function closePane() {
		Object.keys(pane.customHosts).forEach(function (key) {
			var entry = pane.customHosts[key];
			if (entry.onDispose) entry.onDispose(entry.elem);
		});
		pane.customHosts = {};
		pane.component = undefined;
		paneEl.hidden = true;
		paneEl.replaceChildren();
		document.body.classList.remove('pane-open');
	}

	function fieldControl(component, field) {
		var props = component.__host.properties;
		var p = field.properties;
		var id = 'pp-' + field.targetProperty;
		var change = function (value) {
			setProperty(component, field.targetProperty, value);
		};
		switch (field.type) {
			case FieldType.Custom: {
				var key = p.key || field.targetProperty;
				var entry = pane.customHosts[key];
				if (!entry) entry = pane.customHosts[key] = { elem: h('div', { className: 'pp-custom' }) };
				entry.onDispose = p.onDispose;
				p.onRender(entry.elem, undefined, function (target, value) {
					change(value);
				});
				return entry.elem;
			}
			case FieldType.TextField: {
				var input = h('input', { id: id, type: 'text', placeholder: p.placeholder || '' });
				input.value = props[field.targetProperty] || '';
				input.addEventListener('change', function () { change(input.value); });
				return h('div', { className: 'pp-field' }, [h('label', { for: id, text: p.label }), input, p.description ? h('p', { className: 'pp-help', text: p.description }) : null]);
			}
			case FieldType.Slider: {
				var range = h('input', { id: id, type: 'range', min: String(p.min), max: String(p.max), step: String(p.step || 1) });
				range.value = String(props[field.targetProperty]);
				var out = h('output', { for: id, text: String(props[field.targetProperty]) });
				range.addEventListener('input', function () { out.textContent = range.value; });
				range.addEventListener('change', function () { change(Number(range.value)); });
				return h('div', { className: 'pp-field' }, [h('label', { for: id, text: p.label }), h('div', { className: 'pp-row' }, [range, out])]);
			}
			case FieldType.Dropdown: {
				var select = h('select', { id: id }, p.options.map(function (o) { return h('option', { value: o.key, text: o.text }); }));
				select.value = props[field.targetProperty];
				select.addEventListener('change', function () { change(select.value); });
				return h('div', { className: 'pp-field' }, [h('label', { for: id, text: p.label }), select]);
			}
			case FieldType.Toggle: {
				var box = h('input', { id: id, type: 'checkbox', role: 'switch' });
				box.checked = props[field.targetProperty] !== false;
				var state = h('span', { className: 'pp-help', text: box.checked ? p.onText || 'On' : p.offText || 'Off' });
				box.addEventListener('change', function () { change(box.checked); });
				return h('div', { className: 'pp-field' }, [h('label', { for: id, text: p.label }), h('div', { className: 'pp-row' }, [box, state])]);
			}
			case FieldType.Link:
				return h('div', { className: 'pp-field' }, [h('a', { href: p.href, target: p.target || '_self', rel: 'noopener', text: p.text })]);
			default:
				return h('p', { className: 'pp-help', text: 'Field type ' + field.type + ' is not rendered by this host.' });
		}
	}

	function renderPane() {
		var component = pane.component;
		var config = component.getPropertyPaneConfiguration();
		paneEl.replaceChildren();
		var close = h('button', { type: 'button', className: 'pp-close', 'aria-label': 'Close the property pane', text: 'Close' });
		close.addEventListener('click', closePane);
		paneEl.appendChild(h('div', { className: 'pp-top' }, [h('h2', { text: component.__host.title }), close]));
		config.pages.forEach(function (page) {
			if (page.header && page.header.description) paneEl.appendChild(h('p', { className: 'pp-desc', text: page.header.description }));
			page.groups.forEach(function (group) {
				var fs = h('fieldset', { className: 'pp-group' }, [group.groupName ? h('legend', { text: group.groupName }) : null]);
				group.groupFields.forEach(function (field) {
					fs.appendChild(fieldControl(component, field));
				});
				paneEl.appendChild(fs);
			});
		});
	}

	// Web parts -----------------------------------------------------------------
	function mountWebPart(options) {
		dispose();
		return assetFor(options.bundle + '_').then(requireAsset).then(function (mod) {
			var Ctor = exportOf(mod);
			var dom = h('div', { className: 'webpart', 'data-bundle': options.bundle });
			mountPoint.appendChild(dom);
			var wp = new Ctor();
			wp.__host = {
				kind: 'webpart',
				title: options.title,
				dom: dom,
				properties: Object.assign({}, options.properties),
				displayMode: options.displayMode === 'read' ? DisplayMode.Read : DisplayMode.Edit,
			};
			wp.__host.context = makeContext(wp);
			current = wp;
			return Promise.resolve(wp.onInit()).then(function () {
				wp.render();
				return true;
			});
		});
	}

	// Dashboard card + quick view ----------------------------------------------
	function renderCard(ace) {
		var id = ace.renderCard();
		var view = bindView(ace.cardNavigator.create(id), ace);
		var params = view.cardViewParameters;
		log.cardViews.push(params.cardViewType + ':' + (ace.state && ace.state.status));
		var bar = params.cardBar;
		var footer = params.footer;
		var button = h('button', { type: 'button', className: 'card-button', text: footer.title });
		button.addEventListener('click', function (e) {
			e.stopPropagation();
			var a = footer.action;
			log.actions.push({ type: a.type, parameters: a.parameters });
			if (a.type === 'QuickView') showQuickView(ace, a.parameters.view);
			else if (a.type === 'Submit') view.onAction({ type: 'Submit', id: a.parameters.id, data: {} });
		});
		var card = h('article', { className: 'card card-' + params.cardViewType, tabindex: '0', 'aria-label': bar.title }, [
			h('div', { className: 'card-bar' }, [h('img', { src: bar.icon.url, alt: bar.icon.altText || '' }), h('span', { text: bar.title })]),
			params.image ? h('img', { className: 'card-image', src: params.image.url, alt: params.image.altText }) : null,
			h('p', { className: 'card-header', text: params.header.text }),
			h('div', { className: 'card-footer' }, [button]),
		]);
		card.addEventListener('click', function () {
			var sel = view.onCardSelection;
			if (sel) log.actions.push({ type: 'cardSelection:' + sel.type, parameters: sel.parameters });
		});
		mountPoint.replaceChildren(card);
	}

	function showQuickView(ace, viewId) {
		var view = bindView(ace.quickViewNavigator.create(viewId), ace);
		var payload = new window.ACData.Template(view.template).expand({ $root: view.data });
		var adaptive = new window.AdaptiveCards.AdaptiveCard();
		adaptive.onExecuteAction = function (action) {
			log.actions.push({ type: action.getJsonTypeName(), url: action.url, id: action.id });
		};
		adaptive.parse(payload);
		var dialog = h('div', { className: 'quickview', role: 'dialog', 'aria-modal': 'true', 'aria-label': view.data.name });
		var close = h('button', { type: 'button', className: 'pp-close', text: 'Close' });
		close.addEventListener('click', function () { dialog.remove(); });
		dialog.appendChild(h('div', { className: 'pp-top' }, [h('h2', { text: view.data.name }), close]));
		dialog.appendChild(adaptive.render());
		document.body.appendChild(dialog);
	}

	function mountCard(options) {
		dispose();
		return assetFor(options.bundle + '_').then(requireAsset).then(function (mod) {
			var Ctor = exportOf(mod);
			var ace = new Ctor();
			ace.__host = {
				kind: 'card',
				title: options.title,
				properties: Object.assign({}, options.properties),
				displayMode: options.displayMode === 'read' ? DisplayMode.Read : DisplayMode.Edit,
			};
			ace.__host.context = makeContext(ace);
			current = ace;
			return Promise.resolve(ace.onInit()).then(function () {
				renderCard(ace);
				return true;
			});
		});
	}

	function dispose() {
		closePane();
		document.querySelectorAll('.quickview').forEach(function (q) { q.remove(); });
		if (current) {
			if (current.onDispose) current.onDispose();
			current = undefined;
		}
		mountPoint.replaceChildren();
	}

	function setTheme(name) {
		themeState.name = name;
		section.setAttribute('data-variant', name);
		var theme = themeProvider.tryGetTheme();
		themeState.listeners.forEach(function (l) {
			l.fn.call(l.obj, { theme: theme });
		});
	}

	window.__harness = {
		ready: assetsPromise.then(function () { return true; }),
		log: log,
		mountWebPart: mountWebPart,
		mountCard: mountCard,
		openPane: function () { return openPane(current); },
		closePane: closePane,
		setProperty: function (path, value) { setProperty(current, path, value); },
		properties: function () { return Object.assign({}, current.__host.properties); },
		setTheme: setTheme,
		dispose: dispose,
	};
})();
