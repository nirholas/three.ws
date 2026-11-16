import { ISPFxAdaptiveCard, BaseAdaptiveCardQuickView } from '@microsoft/sp-adaptive-card-extension-base';
import * as strings from 'ThreeWsAgentCardAdaptiveCardExtensionStrings';
import template from './template/QuickViewTemplate.json';
import {
  IThreeWsAgentCardAdaptiveCardExtensionProps,
  IThreeWsAgentCardAdaptiveCardExtensionState
} from '../ThreeWsAgentCardAdaptiveCardExtension';

export interface IQuickViewData {
  subTitle: string;
  title: string;
}

export class QuickView extends BaseAdaptiveCardQuickView<
  IThreeWsAgentCardAdaptiveCardExtensionProps,
  IThreeWsAgentCardAdaptiveCardExtensionState,
  IQuickViewData
> {
  public get data(): IQuickViewData {
    return {
      subTitle: strings.SubTitle,
      title: strings.Title
    };
  }

  public get template(): ISPFxAdaptiveCard {
    return template as ISPFxAdaptiveCard;
  }
}
