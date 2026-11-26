/**
 * three.ws 3D Model web part: an interactive 3D model on a modern SharePoint
 * page, picked from the Forge gallery on three.ws or given as any https GLB URL.
 */
import { IPropertyPaneField } from '@microsoft/sp-property-pane';
import { ThemeChangedEventArgs, ThemeProvider } from '@microsoft/sp-component-base';
import * as strings from 'ThreeWsModelWebPartStrings';

import { PropertyPaneSearchPicker } from '../../lib/SearchPickerField';
import { IStageWebPartProps, PaneCopy, StageWebPart } from '../../lib/StageWebPart';
import { resolveTypedModel, searchModelItems } from '../../lib/pickers';
import type { StageCopy, StageSubject } from '../../lib/stage';
import { extractThreeWsId, getModel, normalizeModelUrl } from '../../lib/threeWsApi';

export interface IThreeWsModelWebPartProps extends IStageWebPartProps {
	/** A three.ws model id, or an https URL to a .glb/.gltf file. */
	modelRef: string;
	modelName: string;
}

/** A readable name for a bare GLB URL: its file name without the extension. */
export function nameFromUrl(url: string): string {
	try {
		const file = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
		return file.replace(/\.(glb|gltf)$/i, '').replace(/[-_]+/g, ' ').trim();
	} catch {
		return '';
	}
}

export default class ThreeWsModelWebPart extends StageWebPart<IThreeWsModelWebPartProps> {
	private themeProvider: ThemeProvider | undefined;

	protected async onInit(): Promise<void> {
		this.themeProvider = this.context.serviceScope.consume(ThemeProvider.serviceKey);
		this.onThemeChanged(this.themeProvider.tryGetTheme());
		this.themeProvider.themeChangedEvent.add(this, this.handleThemeChanged);
		await super.onInit();
	}

	private handleThemeChanged(args: ThemeChangedEventArgs): void {
		this.onThemeChanged(args.theme);
	}

	protected subjectKey(): string {
		const ref = (this.properties.modelRef || '').trim();
		return normalizeModelUrl(ref) || extractThreeWsId(ref);
	}

	protected async resolveSubject(key: string): Promise<StageSubject> {
		if (/^https:/i.test(key)) {
			return {
				modelUrl: key,
				name: this.properties.modelName || nameFromUrl(key) || strings.SetupHeading,
				posterUrl: '',
				pageUrl: '',
			};
		}
		const model = await getModel(key);
		if (model.title && model.title !== this.properties.modelName) this.properties.modelName = model.title;
		return { modelUrl: model.glbUrl, name: model.title, posterUrl: model.thumbnailUrl, pageUrl: model.pageUrl };
	}

	protected stageCopy(): StageCopy {
		return {
			setupHeading: strings.SetupHeading,
			setupBody: strings.SetupBody,
			setupButton: strings.SetupButton,
			notSetUp: strings.NotSetUp,
			viewIn3d: strings.ViewIn3d,
			loading: strings.Loading,
			retry: strings.Retry,
			openOnThreeWs: strings.OpenOnThreeWs,
		};
	}

	protected paneCopy(): PaneCopy {
		return strings;
	}

	protected contentFields(): IPropertyPaneField<unknown>[] {
		return [
			PropertyPaneSearchPicker(
				'modelRef',
				{
					key: 'modelPicker',
					label: strings.ModelLabel,
					placeholder: strings.ModelPlaceholder,
					selectedLabel: this.properties.modelName || '',
					selectedValue: this.properties.modelRef || '',
					search: searchModelItems,
					resolveTyped: resolveTypedModel,
					copy: {
						searching: strings.Searching,
						empty: strings.SearchEmpty,
						noneSelected: strings.NoneSelected,
						selected: strings.Selected,
						error: strings.SearchError,
					},
				},
				(item) => {
					this.properties.modelName = item.value === item.subtitle ? '' : item.title;
				},
			),
		];
	}

	protected showChatToggle(): IPropertyPaneField<unknown>[] {
		return [];
	}

	protected onDispose(): void {
		this.themeProvider?.themeChangedEvent.remove(this, this.handleThemeChanged);
		super.onDispose();
	}
}
