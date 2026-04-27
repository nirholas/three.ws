/*!
 * BVHEcctrl
 * https://github.com/pmndrs/BVHEcctrl
 * (c) 2025 @ErdongChen-Andrew
 * Released under the MIT License.
 */

import { create } from "zustand";
import type { CharacterAnimationStatus } from "..";

export interface AnimationStoreState {
  animationStatus: CharacterAnimationStatus;
  setAnimationStatus: (status: CharacterAnimationStatus) => void;
}

export const useAnimationStore = /* @__PURE__ */ create<AnimationStoreState>(
  (set) => ({
    animationStatus: "IDLE",
    setAnimationStatus: (status) => set({ animationStatus: status }),
  })
);
