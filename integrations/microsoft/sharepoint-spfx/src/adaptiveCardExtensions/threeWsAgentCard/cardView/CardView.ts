import {
	BaseComponentsCardView,
	BasicCardView,
	ComponentsCardViewParameters,
	IActionArguments,
	IExternalLinkCardAction,
	IQuickViewCardAction,
	ImageCardView,
} from '@microsoft/sp-adaptive-card-extension-base';
import * as strings from 'ThreeWsAgentCardAdaptiveCardExtensionStrings';
import {
	FALLBACK_POSTER,
	IThreeWsAgentCardAdaptiveCardExtensionProps,
	IThreeWsAgentCardAdaptiveCardExtensionState,
	QUICK_VIEW_REGISTRY_ID,
} from '../ThreeWsAgentCardAdaptiveCardExtension';
import { agentStatus } from '../../../lib/threeWsApi';

const RETRY_ACTION = 'threews-retry';

export class CardView extends BaseComponentsCardView<
	IThreeWsAgentCardAdaptiveCardExtensionProps,
	IThreeWsAgentCardAdaptiveCardExtensionState,
	ComponentsCardViewParameters
> {
	public constructor(private readonly retry: () => void) {
		super();
	}

	public get cardViewParameters(): ComponentsCardViewParameters {
		const cardBar = {
			componentName: 'cardBar' as const,
			title: this.properties.title || strings.DefaultCardTitle,
			icon: { url: FALLBACK_POSTER, altText: '' },
		};
		const { status, agent, error } = this.state;

		if (status === 'ready' && agent) {
			return ImageCardView({
				cardBar,
				header: { componentName: 'text', text: agent.name },
				body: { componentName: 'text', text: agentStatus(agent) },
				image: { url: agent.thumbnailUrl || FALLBACK_POSTER, altText: `${strings.PosterAlt} ${agent.name}` },
				footer: {
					componentName: 'cardButton',
					title: strings.QuickViewButton,
					action: { type: 'QuickView', parameters: { view: QUICK_VIEW_REGISTRY_ID } },
				},
			});
		}

		if (status === 'error') {
			return BasicCardView({
				cardBar,
				header: { componentName: 'text', text: `${strings.ErrorText} ${error}` },
				footer: {
					componentName: 'cardButton',
					title: strings.RetryButton,
					action: { type: 'Submit', parameters: { id: RETRY_ACTION } },
				},
			});
		}

		if (status === 'loading') {
			return BasicCardView({
				cardBar,
				header: { componentName: 'text', text: this.properties.agentName ? `${strings.LoadingNamed} ${this.properties.agentName}` : strings.LoadingText },
			});
		}

		return BasicCardView({
			cardBar,
			header: { componentName: 'text', text: strings.SetupText },
			footer: {
				componentName: 'cardButton',
				title: strings.BrowseButton,
				action: { type: 'ExternalLink', parameters: { target: 'https://three.ws/agents' } },
			},
		});
	}

	public get onCardSelection(): IQuickViewCardAction | IExternalLinkCardAction | undefined {
		const { status, agent } = this.state;
		if (status === 'ready' && agent) return { type: 'ExternalLink', parameters: { target: agent.pageUrl } };
		return undefined;
	}

	public onAction(action: IActionArguments): void {
		if (action.type === 'Submit' && action.id === RETRY_ACTION) {
			this.retry();
		}
	}
}
