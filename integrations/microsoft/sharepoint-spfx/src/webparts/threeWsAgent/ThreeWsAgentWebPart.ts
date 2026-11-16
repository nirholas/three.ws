/**
 * three.ws Agent web part: a live, animated three.ws agent on a modern
 * SharePoint page (and in Teams tabs), with its own voice and chat.
 */
import { IPropertyPaneField, PropertyPaneToggle } from '@microsoft/sp-property-pane';
import { ThemeChangedEventArgs, ThemeProvider } from '@microsoft/sp-component-base';
import * as strings from 'ThreeWsAgentWebPartStrings';

import { PropertyPaneSearchPicker } from '../../lib/SearchPickerField';
import { IStageWebPartProps, PaneCopy, StageWebPart } from '../../lib/StageWebPart';
import { resolveTypedAgent, searchAgentItems } from '../../lib/pickers';
import type { StageCopy, StageSubject } from '../../lib/stage';
import { getAgent, isThreeWsId } from '../../lib/threeWsApi';

export interface IThreeWsAgentWebPartProps extends IStageWebPartProps {
	agentId: string;
	agentName: string;
}

export default class ThreeWsAgentWebPart extends StageWebPart<IThreeWsAgentWebPartProps> {
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
		const id = (this.properties.agentId || '').trim();
		return isThreeWsId(id) ? id : '';
	}

	protected async resolveSubject(key: string): Promise<StageSubject> {
		const agent = await getAgent(key);
		if (agent.name && agent.name !== this.properties.agentName) this.properties.agentName = agent.name;
		return { agentId: agent.id, name: agent.name, posterUrl: agent.thumbnailUrl, pageUrl: agent.pageUrl };
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
				'agentId',
				{
					key: 'agentPicker',
					label: strings.AgentLabel,
					placeholder: strings.AgentPlaceholder,
					selectedLabel: this.properties.agentName || '',
					selectedValue: this.properties.agentId || '',
					search: searchAgentItems,
					resolveTyped: resolveTypedAgent,
					copy: {
						searching: strings.Searching,
						empty: strings.SearchEmpty,
						noneSelected: strings.NoneSelected,
						selected: strings.Selected,
						error: strings.SearchError,
					},
				},
				(item) => {
					this.properties.agentName = item.value === item.subtitle ? '' : item.title;
				},
			),
		];
	}

	protected showChatToggle(): IPropertyPaneField<unknown>[] {
		return [PropertyPaneToggle('chat', { label: strings.ChatLabel, onText: strings.ChatOn, offText: strings.ChatOff })];
	}

	protected onDispose(): void {
		this.themeProvider?.themeChangedEvent.remove(this, this.handleThemeChanged);
		super.onDispose();
	}
}
