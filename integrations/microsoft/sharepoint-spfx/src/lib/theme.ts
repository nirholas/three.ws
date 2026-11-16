/**
 * Maps a SharePoint section theme (theme variants: Neutral, Soft, Strong) to
 * the CSS custom properties Stage.module.scss and the search picker read.
 */
import type { IReadonlyTheme } from '@microsoft/sp-component-base';

export function applyTheme(target: HTMLElement, theme: IReadonlyTheme | undefined): void {
	const s = theme?.semanticColors;
	const p = theme?.palette;
	const vars: Record<string, string | undefined> = {
		'--tw-text': s?.bodyText,
		'--tw-muted': s?.bodySubtext,
		'--tw-surface': s?.bodyBackground,
		'--tw-border': s?.inputBorder || s?.bodyDivider,
		'--tw-accent': s?.primaryButtonBackground,
		'--tw-accent-hover': s?.primaryButtonBackgroundHovered,
		'--tw-accent-text': s?.primaryButtonText,
		'--tw-focus': s?.focusBorder || p?.themePrimary,
		'--tw-hover': s?.buttonBackgroundHovered,
		'--tw-link': s?.link,
	};
	for (const name of Object.keys(vars)) {
		const value = vars[name];
		if (value) target.style.setProperty(name, value);
		else target.style.removeProperty(name);
	}
}
