/*!
 * BVHEcctrl
 * https://github.com/pmndrs/BVHEcctrl
 * (c) 2025 @ErdongChen-Andrew
 * Released under the MIT License.
 */

import * as THREE from "three";
import { create } from "zustand";

export interface StoreState {
  // Environment collider mesh infomation
  colliderMeshesArray: THREE.Mesh[];
  setColliderMeshesArray: (mergedMesh: THREE.Mesh) => void;
  removeColliderMesh: (mergedMesh: THREE.Mesh) => void;
}

export const useEcctrlStore = /* @__PURE__ */ create<StoreState>((set) => {
  return {
    /**
     * Set/remove collider mesh array
     */
    colliderMeshesArray: [],
    setColliderMeshesArray: (mergedMesh: THREE.Mesh) =>
      set((state) => {
        if (!state.colliderMeshesArray.includes(mergedMesh)) {
          return {
            colliderMeshesArray: [...state.colliderMeshesArray, mergedMesh],
          };
        }
        return state;
      }),
    removeColliderMesh: (meshToRemove: THREE.Mesh) =>
      set((state) => ({
        colliderMeshesArray: state.colliderMeshesArray.filter(
          (mesh) => mesh !== meshToRemove
        ),
      })),
  };
});

/**
 * useEcctrlStore Back-up
 */
// export const useEcctrlStore = /* @__PURE__ */ create(
//   /* @__PURE__ */ subscribeWithSelector<StoreState>((set) => {
//     return {
//       /**
//        * Set/remove collider mesh array
//        */
//       colliderMeshesArray: [],
//       setColliderMeshesArray: (mergedMesh: THREE.Mesh) =>
//         set((state) => {
//           if (!state.colliderMeshesArray.includes(mergedMesh)) {
//             return {
//               colliderMeshesArray: [...state.colliderMeshesArray, mergedMesh],
//             };
//           }
//           return state;
//         }),
//       removeColliderMesh: (meshToRemove: THREE.Mesh) =>
//         set((state) => ({
//           colliderMeshesArray: state.colliderMeshesArray.filter(
//             (mesh) => mesh !== meshToRemove
//           ),
//         })),
//     };
//   })
// );
