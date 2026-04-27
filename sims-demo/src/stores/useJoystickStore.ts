/*!
 * BVHEcctrl
 * https://github.com/pmndrs/BVHEcctrl
 * (c) 2025 @ErdongChen-Andrew
 * Released under the MIT License.
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export interface JoystickStoreState {
  joystickActive: boolean;
  joystickX: number;
  joystickY: number;
  setJoystick: (x: number, y: number) => void;
  resetJoystick: () => void;
}

export const useJoystickStore = /* @__PURE__ */ create(
  /* @__PURE__ */ subscribeWithSelector<JoystickStoreState>((set) => ({
    joystickActive: false,
    joystickX: 0,
    joystickY: 0,
    setJoystick: (x: number, y: number) =>
      set({
        joystickActive: !(x === 0 && y === 0),
        joystickX: x,
        joystickY: y,
      }),
    resetJoystick: () =>
      set({ joystickActive: false, joystickX: 0, joystickY: 0 }),
  }))
);
