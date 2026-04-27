/*!
 * BVHEcctrl
 * https://github.com/pmndrs/BVHEcctrl
 * (c) 2025 @ErdongChen-Andrew
 * Released under the MIT License.
 */

import BVHEcctrl from "./BVHEcctrl";
export default BVHEcctrl;

export { characterStatus } from "./BVHEcctrl";
export type { BVHEcctrlApi } from "./BVHEcctrl";
export type { EcctrlProps } from "./BVHEcctrl";
export type { CharacterStatus } from "./BVHEcctrl";

export { default as StaticCollider } from "./StaticCollider";
export type { StaticColliderProps } from "./StaticCollider";

export { default as KinematicCollider } from "./KinematicCollider";
export type { KinematicColliderProps } from "./KinematicCollider";

export { default as InstancedStaticCollider } from "./InstancedStaticCollider";

export { default as Joystick } from "./Joystick";
export type { JoystickProps } from "./Joystick";

export { default as VirtualButton } from "./VirtualButton";
export type { VirtualButtonProps } from "./VirtualButton";

export { useEcctrlStore } from "./stores/useEcctrlStore";
export type { StoreState } from "./stores/useEcctrlStore";

export { useJoystickStore } from "./stores/useJoystickStore";
export type { JoystickStoreState } from "./stores/useJoystickStore";

export { useButtonStore } from "./stores/useButtonStore";
export type { ButtonStoreState } from "./stores/useButtonStore";

export { useAnimationStore } from "./stores/useAnimationStore";
export type { AnimationStoreState } from "./stores/useAnimationStore";

// Export types for movement input and character animation status
export type MovementInput = {
  forward?: boolean;
  backward?: boolean;
  leftward?: boolean;
  rightward?: boolean;
  joystick?: { x: number; y: number };
  run?: boolean;
  jump?: boolean;
};
export type CharacterAnimationStatus =
  | "IDLE"
  | "WALK"
  | "RUN"
  | "JUMP_START"
  | "JUMP_IDLE"
  | "JUMP_FALL"
  | "JUMP_LAND";
export type FloatCheckType = "RAYCAST" | "SHAPECAST" | "BOTH";
