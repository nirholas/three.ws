/*!
 * BVHEcctrl
 * https://github.com/pmndrs/BVHEcctrl
 * (c) 2025 @ErdongChen-Andrew
 * Released under the MIT License.
 */

import * as THREE from "three";
import React, { useEffect, useRef, type ReactNode, forwardRef, type RefObject, useMemo, } from "react";
import { useThree } from "@react-three/fiber";
import { MeshBVHHelper, computeBoundsTree, disposeBoundsTree, acceleratedRaycast, SAH, type SplitStrategy } from "three-mesh-bvh";
import { useEcctrlStore } from "./stores/useEcctrlStore";

export interface StaticColliderProps extends Omit<React.ComponentProps<'group'>, 'ref'> {
    children?: ReactNode;
    debug?: boolean;
    debugVisualizeDepth?: number;
    restitution?: number;
    friction?: number;
    excludeFloatHit?: boolean;
    excludeCollisionCheck?: boolean;
    BVHOptions?: {
        strategy?: SplitStrategy
        verbose?: boolean
        setBoundingBox?: boolean
        maxDepth?: number
        maxLeafTris?: number
        indirect?: boolean
    }
};

const InstancedStaticCollider = forwardRef<THREE.Group, StaticColliderProps>(({
    children,
    debug = false,
    debugVisualizeDepth = 10,
    restitution = 0.05,
    friction = 0.8,
    excludeFloatHit = false,
    excludeCollisionCheck = false,
    BVHOptions = {
        strategy: SAH,
        verbose: false,
        setBoundingBox: true,
        maxDepth: 40,
        maxLeafTris: 10,
        indirect: false,
    },
    ...props
}, ref) => {
    /**
     * Initialize setups
     */
    const { scene, gl } = useThree()
    const mergedMesh = useRef<THREE.InstancedMesh | null>(null)
    const bvhHelper = useRef<MeshBVHHelper | null>(null)
    const colliderRef = (ref as RefObject<THREE.Group>) ?? useRef<THREE.Group | null>(null);
    const tempMatrix = useRef<THREE.Matrix4>(new THREE.Matrix4());

    /**
     * Generate merged static geometry and BVH tree for collision detection
     */
    useEffect(() => {
        // Exit if colliderRef.current if not ready
        if (!colliderRef.current) return;
        // Recalculate the world matrix of the object and descendants on the current frame
        colliderRef.current.updateMatrixWorld(true);

        // Retrieve meshes from colliderRef.current
        colliderRef.current.traverse(obj => {
            if (!(obj instanceof THREE.InstancedMesh)) return;
            const mesh = obj as THREE.InstancedMesh;
            const geometry = mesh.geometry;

            // Skip if missing required attributes
            const position = geometry.getAttribute('position');
            const normal = geometry.getAttribute('normal');
            if (!position || !normal) return;
            // Only clean and clone geometry once
            const baseGeom = geometry.index ? geometry.toNonIndexed() : geometry.clone();

            // Strip everything except position and normal and apply matrix transform
            const cleanGeom = new THREE.BufferGeometry();
            cleanGeom.setAttribute('position', baseGeom.getAttribute('position').clone());
            cleanGeom.setAttribute('normal', baseGeom.getAttribute('normal').clone());
            cleanGeom.applyMatrix4(mesh.matrixWorld);

            // Create boundsTree and mesh from clean geometry 
            cleanGeom.computeBoundsTree = computeBoundsTree
            cleanGeom.disposeBoundsTree = disposeBoundsTree
            cleanGeom.computeBoundsTree(BVHOptions)

            // Create inteanced mergedMesh from cleanGeom
            mergedMesh.current = new THREE.InstancedMesh(cleanGeom, undefined, mesh.count)
            // Apply mesh individual matrix to mergedMesh individual matrix
            for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, tempMatrix.current);
                tempMatrix.current.premultiply(mesh.matrix)
                mergedMesh.current.setMatrixAt(i, tempMatrix.current)
            }
            mergedMesh.current.instanceMatrix.needsUpdate = true;

            // Preset merged mesh user data
            mergedMesh.current.userData = { restitution, friction, excludeFloatHit, excludeCollisionCheck, type: "STATIC" };

            // Save the merged mesh to globle store
            // Character can retrieve and collider with merged mesh later
            useEcctrlStore.getState().setColliderMeshesArray(mergedMesh.current)
        })

        // Clean up geometry/boundsTree/mesh/bvhHelper 
        return () => {
            if (mergedMesh.current) {
                useEcctrlStore.getState().removeColliderMesh(mergedMesh.current)
                mergedMesh.current.geometry.disposeBoundsTree?.();
                mergedMesh.current.geometry.dispose();
                if (Array.isArray(mergedMesh.current.material)) {
                    mergedMesh.current.material.forEach(mat => mat.dispose());
                } else {
                    mergedMesh.current.material.dispose()
                }
                mergedMesh.current = null
            }
            if (bvhHelper.current) {
                scene.remove(bvhHelper.current);
                (bvhHelper.current as any).dispose?.()
                bvhHelper.current = null
            };
        };
    }, [])

    /**
     * Update merged mesh properties and user data
     */
    useEffect(() => {
        if (mergedMesh.current) {
            mergedMesh.current.visible = props.visible ?? true
            mergedMesh.current.userData.friction = friction
            mergedMesh.current.userData.restitution = restitution
            mergedMesh.current.userData.excludeFloatHit = excludeFloatHit
            mergedMesh.current.userData.excludeCollisionCheck = excludeCollisionCheck
        }
    }, [props.visible, friction, restitution, excludeFloatHit, excludeCollisionCheck])

    /**
     * Update BVH debug helper
     */
    useEffect(() => {
        if (mergedMesh.current) {
            // If bvhHelper.current exist, only targgle visible
            // Else create bvhHelper from mergedMesh.current
            if (bvhHelper.current) {
                bvhHelper.current.visible = debug
            } else {
                bvhHelper.current = new MeshBVHHelper(mergedMesh.current, 20)
                bvhHelper.current.visible = debug
                scene.add(bvhHelper.current)
            }
        }
    }, [debug])

    return (
        <group ref={colliderRef} {...props} dispose={null}>
            {/* Static collider model */}
            {children}
        </group>
    );
})

export default React.memo(InstancedStaticCollider);