import { IPropertyPaneConfiguration, PropertyPaneTextField } from '@microsoft/sp-property-pane';
import * as strings from 'ThreeWsAgentCardAdaptiveCardExtensionStrings';
import { PropertyPaneSearchPicker } from '../../lib/SearchPickerField';
import { resolveTypedAgent, searchAgentItems } from '../../lib/pickers';
import type { IThreeWsAgentCardAdaptiveCardExtensionProps } from './ThreeWsAgentCardAdaptiveCardExtension';

export class ThreeWsAgentCardPropertyPane {
	public getPropertyPaneConfiguration(props: IThreeWsAgentCardAdaptiveCardExtensionProps): IPropertyPaneConfiguration {
		return {
			pages: [
				{
					header: { description: strings.PropertyPaneDescription },
					groups: [
						{
							groupFields: [
								PropertyPaneSearchPicker(
									'agentId',
									{
										key: 'agentCardPicker',
										label: strings.AgentLabel,
										placeholder: strings.AgentPlaceholder,
										selectedLabel: props.agentName || '',
										selectedValue: props.agentId || '',
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
										props.agentName = item.value === item.subtitle ? '' : item.title;
									},
								),
								PropertyPaneTextField('title', { label: strings.TitleFieldLabel }),
							],
						},
					],
				},
			],
		};
	}
}
