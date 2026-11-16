import { ISPFxAdaptiveCard, BaseAdaptiveCardQuickView } from '@microsoft/sp-adaptive-card-extension-base';
import * as strings from 'ThreeWsAgentCardAdaptiveCardExtensionStrings';
import template from './template/QuickViewTemplate.json';
import {
	FALLBACK_POSTER,
	IThreeWsAgentCardAdaptiveCardExtensionProps,
	IThreeWsAgentCardAdaptiveCardExtensionState,
} from '../ThreeWsAgentCardAdaptiveCardExtension';
import { agentStatus } from '../../../lib/threeWsApi';

export interface IQuickViewData {
	name: string;
	status: string;
	description: string;
	posterUrl: string;
	posterAlt: string;
	pageUrl: string;
	openLabel: string;
}

export class QuickView extends BaseAdaptiveCardQuickView<
	IThreeWsAgentCardAdaptiveCardExtensionProps,
	IThreeWsAgentCardAdaptiveCardExtensionState,
	IQuickViewData
> {
	public get data(): IQuickViewData {
		const agent = this.state.agent;
		const name = agent?.name || this.properties.agentName || strings.DefaultCardTitle;
		return {
			name,
			status: agent ? agentStatus(agent) : strings.LoadingText,
			description: agent?.description || strings.NoDescription,
			posterUrl: agent?.thumbnailUrl || FALLBACK_POSTER,
			posterAlt: `${strings.PosterAlt} ${name}`,
			pageUrl: agent?.pageUrl || 'https://three.ws/agents',
			openLabel: `${strings.OpenButton} ${name}`,
		};
	}

	public get template(): ISPFxAdaptiveCard {
		return template as ISPFxAdaptiveCard;
	}
}
