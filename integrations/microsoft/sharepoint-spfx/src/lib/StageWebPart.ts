/**
 * Shared base for the three.ws Agent and three.ws 3D Model web parts: the
 * resolve-then-render flow, the record cache, theme variants, and the display
 * group of the property pane. Each subclass says how to resolve its subject
 * and adds its own picker.
 */
import { DisplayMode, Version } from '@microsoft/sp-core-library';
import {
	IPropertyPaneConfiguration,
	IPropertyPaneField,
	PropertyPaneDropdown,
	PropertyPaneLink,
	PropertyPaneSlider,
	PropertyPaneTextField,
	PropertyPaneToggle,
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import type { IReadonlyTheme } from '@microsoft/sp-component-base';

import { Background, Framing, MAX_HEIGHT, MIN_HEIGHT, StageCopy, StageOptions, StageSubject, ThreeWsStage, clampHeight } from './stage';
import { applyTheme } from './theme';

export interface IStageWebPartProps {
	title: string;
	height: number;
	background: Background;
	framing: Framing;
	autoplay: boolean;
	chat: boolean;
	namePlate: boolean;
}

export interface PaneCopy {
	paneDescription: string;
	contentGroup: string;
	displayGroup: string;
	titleLabel: string;
	titleDescription: string;
	heightLabel: string;
	backgroundLabel: string;
	backgroundTransparent: string;
	backgroundDark: string;
	backgroundLight: string;
	framingLabel: string;
	framingFull: string;
	framingPortrait: string;
	autoplayLabel: string;
	autoplayOn: string;
	autoplayOff: string;
	namePlateLabel: string;
	openOnThreeWs: string;
	learnMore: string;
}

const BACKGROUNDS: Background[] = ['transparent', 'dark', 'light'];

export abstract class StageWebPart<P extends IStageWebPartProps> extends BaseClientSideWebPart<P> {
	private stage: ThreeWsStage | undefined;
	private cache: { key: string; subject: StageSubject } | undefined;
	private resolving: string | undefined;

	/** Stable key for what the web part currently points at, or '' when unset. */
	protected abstract subjectKey(): string;
	protected abstract resolveSubject(key: string): Promise<StageSubject>;
	protected abstract stageCopy(): StageCopy;
	protected abstract paneCopy(): PaneCopy;
	protected abstract contentFields(): IPropertyPaneField<unknown>[];
	protected abstract showChatToggle(): IPropertyPaneField<unknown>[];

	protected get dataVersion(): Version {
		return Version.parse('1.0');
	}

	protected get disableReactivePropertyChanges(): boolean {
		return false;
	}

	protected onThemeChanged(theme: IReadonlyTheme | undefined): void {
		applyTheme(this.domElement, theme);
	}

	protected options(subject?: StageSubject): StageOptions {
		const p = this.properties;
		return {
			title: (p.title || '').trim() || subject?.name || this.stageCopy().setupHeading,
			height: clampHeight(p.height),
			background: BACKGROUNDS.indexOf(p.background) >= 0 ? p.background : 'transparent',
			framing: p.framing === 'portrait' ? 'portrait' : 'full',
			autoplay: p.autoplay !== false,
			chat: p.chat !== false,
			namePlate: p.namePlate === true,
		};
	}

	/** The subject record, cached so pane edits to size or colour do not refetch it. */
	protected currentSubject(): StageSubject | undefined {
		const key = this.subjectKey();
		return this.cache && this.cache.key === key ? this.cache.subject : undefined;
	}

	public render(): void {
		if (!this.stage) this.stage = new ThreeWsStage(this.domElement, this.stageCopy());
		const stage = this.stage;
		const key = this.subjectKey();
		if (!key) {
			stage.renderSetup(this.options(), this.displayMode === DisplayMode.Edit, () => this.context.propertyPane.open());
			return;
		}
		const cached = this.currentSubject();
		if (cached) {
			this.show(cached);
			return;
		}
		if (this.resolving === key) return;
		this.resolving = key;
		stage.renderLoading(this.options());
		this.resolveSubject(key).then(
			(subject) => {
				if (this.resolving !== key) return;
				this.resolving = undefined;
				this.cache = { key, subject };
				this.show(subject);
				this.onSubjectResolved();
			},
			(err: Error) => {
				if (this.resolving !== key) return;
				this.resolving = undefined;
				stage.renderError(this.options(), err.message || 'Something went wrong loading this from three.ws.', () => this.render());
			},
		);
	}

	/** Once the record is known the pane can show its name and page link. */
	private onSubjectResolved(): void {
		if (this.context.propertyPane.isPropertyPaneOpen()) this.context.propertyPane.refresh();
	}

	private show(subject: StageSubject): void {
		const stage = this.stage as ThreeWsStage;
		stage.renderSubject(this.options(subject), subject, (message) =>
			stage.renderError(this.options(subject), message, () => this.show(subject), subject.pageUrl),
		);
	}

	protected onPropertyPaneFieldChanged(propertyPath: string, oldValue: unknown, newValue: unknown): void {
		if (oldValue === newValue) return;
		if (propertyPath === 'height') this.properties.height = clampHeight(newValue);
	}

	protected onDispose(): void {
		this.resolving = undefined;
		this.stage?.dispose();
		this.stage = undefined;
	}

	protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
		const c = this.paneCopy();
		const subject = this.currentSubject();
		const content: IPropertyPaneField<unknown>[] = [
			...this.contentFields(),
			PropertyPaneTextField('title', {
				label: c.titleLabel,
				description: c.titleDescription,
				placeholder: subject?.name || '',
			}),
		];
		if (subject?.pageUrl) {
			content.push(PropertyPaneLink('pageLink', { href: subject.pageUrl, text: c.openOnThreeWs, target: '_blank' }));
		}
		return {
			pages: [
				{
					header: { description: c.paneDescription },
					groups: [
						{ groupName: c.contentGroup, groupFields: content },
						{
							groupName: c.displayGroup,
							groupFields: [
								PropertyPaneSlider('height', { label: c.heightLabel, min: MIN_HEIGHT, max: MAX_HEIGHT, step: 20, showValue: true }),
								PropertyPaneDropdown('background', {
									label: c.backgroundLabel,
									options: [
										{ key: 'transparent', text: c.backgroundTransparent },
										{ key: 'dark', text: c.backgroundDark },
										{ key: 'light', text: c.backgroundLight },
									],
								}),
								PropertyPaneDropdown('framing', {
									label: c.framingLabel,
									options: [
										{ key: 'full', text: c.framingFull },
										{ key: 'portrait', text: c.framingPortrait },
									],
								}),
								PropertyPaneToggle('autoplay', { label: c.autoplayLabel, onText: c.autoplayOn, offText: c.autoplayOff }),
								...this.showChatToggle(),
								PropertyPaneToggle('namePlate', { label: c.namePlateLabel }),
								PropertyPaneLink('learnMore', { href: 'https://three.ws/docs/microsoft-sharepoint', text: c.learnMore, target: '_blank' }),
							],
						},
					],
				},
			],
		};
	}
}
