import { derived } from 'svelte/store';
import { locale } from './stores.js';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

const translations = { 'en': en, 'zh-CN': zhCN };

export const t = derived(locale, ($locale) => {
	const dict = translations[$locale] || en;
	return (key, vars = {}) => {
		let str = dict[key] ?? en[key] ?? key;
		for (const [k, v] of Object.entries(vars)) {
			str = str.replace(`{${k}}`, String(v));
		}
		return str;
	};
});
