import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DisplayMode as PageDisplayMode, Version } from '@microsoft/sp-core-library';
import {
  type IPropertyPaneConfiguration,
  PropertyPaneChoiceGroup,
  PropertyPaneLink,
  PropertyPaneSlider,
  PropertyPaneTextField
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import type { IReadonlyTheme } from '@microsoft/sp-component-base';

import * as strings from 'ThreeWs3DViewerWebPartStrings';
import ThreeWs3DViewer from './components/ThreeWs3DViewer';
import type { IThreeWs3DViewerProps } from './components/IThreeWs3DViewerProps';
import { CATALOG_URL, clampHeight, type DisplayMode, resolveModelUrl, validateModelUrl } from './lib/model';
import { RUNTIME_TRUSTED_SOURCE } from './lib/runtime';

export interface IThreeWs3DViewerWebPartProps {
  modelUrl: string;
  title: string;
  displayMode: DisplayMode;
  height: number;
}

export default class ThreeWs3DViewerWebPart extends BaseClientSideWebPart<IThreeWs3DViewerWebPartProps> {
  private _root: Root | undefined;

  public render(): void {
    const modelUrl = resolveModelUrl(this.properties.modelUrl);
    const element: React.ReactElement<IThreeWs3DViewerProps> = React.createElement(ThreeWs3DViewer, {
      modelUrl,
      hasInvalidUrl: !!(this.properties.modelUrl || '').trim() && !modelUrl,
      title: (this.properties.title || '').trim(),
      displayMode: this.properties.displayMode === 'component' ? 'component' : 'viewer',
      height: clampHeight(this.properties.height),
      isEditMode: this.displayMode === PageDisplayMode.Edit,
      onConfigure: () => this.context.propertyPane.open()
    });

    if (!this._root) {
      this._root = createRoot(this.domElement);
    }
    this._root.render(element);
  }

  protected onThemeChanged(currentTheme: IReadonlyTheme | undefined): void {
    const colors = currentTheme?.semanticColors;
    if (!colors) return;
    const set = (name: string, value: string | undefined): void => {
      this.domElement.style.setProperty(name, value || null);
    };
    set('--threews-body-text', colors.bodyText);
    set('--threews-subtle-text', colors.bodySubtext);
    set('--threews-link', colors.link);
    set('--threews-link-hovered', colors.linkHovered);
    set('--threews-surface', colors.bodyStandoutBackground);
    set('--threews-border', colors.bodyDivider);
    set('--threews-accent', colors.primaryButtonBackground);
    set('--threews-accent-hovered', colors.primaryButtonBackgroundHovered);
    set('--threews-accent-text', colors.primaryButtonText);
    set('--threews-error-background', colors.errorBackground);
    set('--threews-error-text', colors.errorText);
  }

  protected onDispose(): void {
    this._root?.unmount();
    this._root = undefined;
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: { description: strings.PropertyPaneDescription },
          groups: [
            {
              groupName: strings.ModelGroupName,
              groupFields: [
                PropertyPaneTextField('modelUrl', {
                  label: strings.ModelUrlFieldLabel,
                  description: strings.ModelUrlFieldDescription,
                  placeholder: 'https://example.com/model.glb',
                  onGetErrorMessage: validateModelUrl,
                  deferredValidationTime: 400
                }),
                PropertyPaneLink('catalogLink', {
                  text: strings.CatalogLinkText,
                  href: CATALOG_URL,
                  target: '_blank'
                }),
                PropertyPaneTextField('title', {
                  label: strings.TitleFieldLabel,
                  description: strings.TitleFieldDescription,
                  maxLength: 120
                })
              ]
            },
            {
              groupName: strings.DisplayGroupName,
              groupFields: [
                PropertyPaneChoiceGroup('displayMode', {
                  label: strings.DisplayModeFieldLabel,
                  options: [
                    { key: 'viewer', text: strings.DisplayModeViewer },
                    { key: 'component', text: strings.DisplayModeComponent }
                  ]
                }),
                PropertyPaneLink('trustedSourceHelp', {
                  text: `${strings.TrustedSourceHelp} ${RUNTIME_TRUSTED_SOURCE}`,
                  href: 'https://learn.microsoft.com/sharepoint/dev/spfx/web-parts/basics/trusted-script-sources',
                  target: '_blank'
                }),
                PropertyPaneSlider('height', {
                  label: strings.HeightFieldLabel,
                  min: 240,
                  max: 900,
                  step: 20,
                  showValue: true
                })
              ]
            }
          ]
        }
      ]
    };
  }
}
