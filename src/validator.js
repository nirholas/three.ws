import { LoaderUtils } from 'three';
import { validateBytes } from 'gltf-validator';

import { ValidatorReport } from './components/validator-report';

const SEVERITY_MAP = ['Errors', 'Warnings', 'Infos', 'Hints'];

export class Validator {
	/**
	 * @param  {Element} el
	 */
	constructor(el) {
		this.el = el;
		this.report = null;


	}

	/**
	 * Runs validation against the given file URL and extra resources.
	 * @param  {string} rootFile
	 * @param  {string} rootPath
	 * @param  {Map<string, File>} assetMap
	 * @param  {Object} response
	 * @return {Promise}
	 */
	validate(rootFile, rootPath, assetMap, response) {
		// Use Three.js Cache to avoid re-downloading the model.
		// Cache.enabled is set to true in viewer.js.
		const fetchBuffer = window.THREE && window.THREE.Cache && window.THREE.Cache.get(rootFile)
			? Promise.resolve(window.THREE.Cache.get(rootFile))
				.then((data) => {
					if (data instanceof ArrayBuffer) return data;
					// Cache may hold string for .gltf; convert
					if (typeof data === 'string') return new TextEncoder().encode(data).buffer;
					return fetch(rootFile).then((r) => r.arrayBuffer());
				})
			: fetch(rootFile).then((r) => r.arrayBuffer());

		return fetchBuffer
			.then((buffer) =>
				validateBytes(new Uint8Array(buffer), {
					externalResourceFunction: (uri) =>
						this.resolveExternalResource(uri, rootFile, rootPath, assetMap),
				}),
			)
			.then((report) => this.setReport(report, response))
			.catch((e) => this.setReportException(e));
	}

	/**
	 * Loads a resource (either locally or from the network) and returns it.
	 * @param  {string} uri
	 * @param  {string} rootFile
	 * @param  {string} rootPath
	 * @param  {Map<string, File>} assetMap
	 * @return {Promise<Uint8Array>}
	 */
	resolveExternalResource(uri, rootFile, rootPath, assetMap) {
		const baseURL = LoaderUtils.extractUrlBase(rootFile);
		const normalizedURL =
			rootPath +
			decodeURI(uri) // validator applies URI encoding.
				.replace(baseURL, '')
				.replace(/^(\.?\/)/, '');

		let objectURL;

		if (assetMap.has(normalizedURL)) {
			const object = assetMap.get(normalizedURL);
			objectURL = URL.createObjectURL(object);
		}

		return fetch(objectURL || baseURL + uri)
			.then((response) => response.arrayBuffer())
			.then((buffer) => {
				if (objectURL) URL.revokeObjectURL(objectURL);
				return new Uint8Array(buffer);
			});
	}

	/**
	 * @param {GLTFValidator.Report} report
	 * @param {Object} response
	 */
	setReport(report, response) {
		report.generator = (report && report.info && report.info.generator) || '';
		report.issues.maxSeverity = -1;
		SEVERITY_MAP.forEach((severity, index) => {
			if (report.issues[`num${severity}`] > 0 && report.issues.maxSeverity === -1) {
				report.issues.maxSeverity = index;
			}
		});
		report.errors = report.issues.messages.filter((msg) => msg.severity === 0);
		report.warnings = report.issues.messages.filter((msg) => msg.severity === 1);
		report.infos = report.issues.messages.filter((msg) => msg.severity === 2);
		report.hints = report.issues.messages.filter((msg) => msg.severity === 3);
		groupMessages(report);
		this.report = report;

		this.setResponse(response);



		function groupMessages(report) {
			const CODES = {
				ACCESSOR_NON_UNIT: {
					message: '{count} accessor elements not of unit length: 0. [AGGREGATED]',
					pointerCounts: {},
				},
				ACCESSOR_ANIMATION_INPUT_NON_INCREASING: {
					message:
						'{count} animation input accessor elements not in ascending order. [AGGREGATED]',
					pointerCounts: {},
				},
			};

			report.errors.forEach((message) => {
				if (!CODES[message.code]) return;
				if (!CODES[message.code].pointerCounts[message.pointer]) {
					CODES[message.code].pointerCounts[message.pointer] = 0;
				}
				CODES[message.code].pointerCounts[message.pointer]++;
			});
			report.errors = report.errors.filter((message) => {
				if (!CODES[message.code]) return true;
				if (!CODES[message.code].pointerCounts[message.pointer]) return true;
				return CODES[message.code].pointerCounts[message.pointer] < 2;
			});
			Object.keys(CODES).forEach((code) => {
				Object.keys(CODES[code].pointerCounts).forEach((pointer) => {
					report.errors.push({
						code: code,
						pointer: pointer,
						message: CODES[code].message.replace(
							'{count}',
							CODES[code].pointerCounts[pointer],
						),
					});
				});
			});
		}
	}

	/**
	 * @param {Object} response
	 */
	setResponse(response) {
		const json = response && response.parser && response.parser.json;

		if (!json) return;

		if (json.asset && json.asset.extras) {
			const extras = json.asset.extras;
			this.report.info.extras = {};
			if (extras.author) {
				this.report.info.extras.author = linkify(escapeHTML(extras.author));
			}
			if (extras.license) {
				this.report.info.extras.license = linkify(escapeHTML(extras.license));
			}
			if (extras.source) {
				this.report.info.extras.source = linkify(escapeHTML(extras.source));
			}
			if (extras.title) {
				this.report.info.extras.title = extras.title;
			}
		}
	}

	/**
	 * @param {Error} e
	 */
	setReportException(e) {
		this.report = null;
	}


	showLightbox() {
		if (!this.report) return;
		const tab = window.open('', '_blank');
		tab.document.body.innerHTML = `
			<!DOCTYPE html>
			<title>glTF 2.0 validation report</title>
			<link href="https://fonts.googleapis.com/css?family=Raleway:300,400" rel="stylesheet">
			<link rel="stylesheet" href="{{location.protocol}}//{{location.host}}/style.css">
			<style>
				body { overflow-y: auto; }
				html, body { background: #FFFFFF; }
			</style>
			${ValidatorReport({ ...this.report, location })}`;
	}
}

function escapeHTML(unsafe) {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function linkify(text) {
	const urlPattern = /\b(?:https?):\/\/[a-z0-9-+&@#\/%?=~_|!:,.;]*[a-z0-9-+&@#\/%=~_|]/gim;
	const emailAddressPattern = /(([a-zA-Z0-9_\-\.]+)@[a-zA-Z_]+?(?:\.[a-zA-Z]{2,6}))+/gim;
	return text
		.replace(urlPattern, '<a target="_blank" href="$&">$&</a>')
		.replace(emailAddressPattern, '<a target="_blank" href="mailto:$1">$1</a>');
}
