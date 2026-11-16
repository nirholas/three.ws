/**
 * three.ws Agent card for Viva Connections dashboards: the agent's name,
 * avatar poster and live status, a quick view with its description, and a
 * button that opens the agent's page on three.ws to talk to it.
 */
import type { IPropertyPaneConfiguration } from '@microsoft/sp-property-pane';
import { BaseAdaptiveCardExtension } from '@microsoft/sp-adaptive-card-extension-base';
import { CardView } from './cardView/CardView';
import { QuickView } from './quickView/QuickView';
import type { ThreeWsAgentCardPropertyPane } from './ThreeWsAgentCardPropertyPane';
import { AgentSummary, getAgent, isThreeWsId } from '../../lib/threeWsApi';

export interface IThreeWsAgentCardAdaptiveCardExtensionProps {
	title: string;
	agentId: string;
	agentName: string;
}

export type AgentCardStatus = 'unset' | 'loading' | 'ready' | 'error';

export interface IThreeWsAgentCardAdaptiveCardExtensionState {
	status: AgentCardStatus;
	agent: AgentSummary | undefined;
	error: string;
}

const CARD_VIEW_REGISTRY_ID: string = 'ThreeWsAgentCard_CARD_VIEW';
export const QUICK_VIEW_REGISTRY_ID: string = 'ThreeWsAgentCard_QUICK_VIEW';
/** Brand mark shown when an agent has no rendered poster yet. */
export const FALLBACK_POSTER = 'https://three.ws/apple-touch-icon.png';

export default class ThreeWsAgentCardAdaptiveCardExtension extends BaseAdaptiveCardExtension<
	IThreeWsAgentCardAdaptiveCardExtensionProps,
	IThreeWsAgentCardAdaptiveCardExtensionState
> {
	private deferredPropertyPane: ThreeWsAgentCardPropertyPane | undefined;
	private request: AbortController | undefined;

	public onInit(): Promise<void> {
		this.state = { status: 'unset', agent: undefined, error: '' };
		this.cardNavigator.register(CARD_VIEW_REGISTRY_ID, () => new CardView(() => this.loadAgent()));
		this.quickViewNavigator.register(QUICK_VIEW_REGISTRY_ID, () => new QuickView());
		// The card renders its loading state straight away; the agent fills in when it arrives.
		this.loadAgent();
		return Promise.resolve();
	}

	/** Fetches the configured agent from three.ws and moves the card to ready or error. */
	public loadAgent(): void {
		this.request?.abort();
		const id = (this.properties.agentId || '').trim();
		if (!isThreeWsId(id)) {
			this.setState({ status: 'unset', agent: undefined, error: '' });
			return;
		}
		const controller = new AbortController();
		this.request = controller;
		this.setState({ status: 'loading', error: '' });
		getAgent(id, { signal: controller.signal }).then(
			(agent) => {
				if (controller.signal.aborted) return;
				this.properties.agentName = agent.name;
				this.setState({ status: 'ready', agent, error: '' });
			},
			(err: Error) => {
				if (controller.signal.aborted) return;
				this.setState({ status: 'error', agent: undefined, error: err.message });
			},
		);
	}

	protected loadPropertyPaneResources(): Promise<void> {
		return import(
			/* webpackChunkName: 'ThreeWsAgentCard-property-pane'*/
			'./ThreeWsAgentCardPropertyPane'
		).then((component) => {
			this.deferredPropertyPane = new component.ThreeWsAgentCardPropertyPane();
		});
	}

	protected onPropertyPaneFieldChanged(propertyPath: string, oldValue: unknown, newValue: unknown): void {
		if (propertyPath === 'agentId' && oldValue !== newValue) this.loadAgent();
	}

	protected renderCard(): string | undefined {
		return CARD_VIEW_REGISTRY_ID;
	}

	protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
		return this.deferredPropertyPane?.getPropertyPaneConfiguration(this.properties) ?? super.getPropertyPaneConfiguration();
	}

	protected onDispose(): void {
		this.request?.abort();
	}
}
