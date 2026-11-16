import type { DisplayMode } from '../helpers/model';

export interface IThreeWs3DViewerProps {
  /** The resolved https model file URL, or undefined when none is configured. */
  modelUrl: string | undefined;
  /** True when the author typed something that is not an https link. */
  hasInvalidUrl: boolean;
  title: string;
  displayMode: DisplayMode;
  height: number;
  isEditMode: boolean;
  onConfigure: () => void;
}
