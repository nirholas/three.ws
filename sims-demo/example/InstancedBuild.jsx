import * as THREE from "three";
import { Clone, Helper, Merged, useGLTF, useHelper } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { MeshBVHHelper } from "three-mesh-bvh";
import { useEcctrlStore } from "../src/stores/useEcctrlStore";
import { useThree } from "@react-three/fiber";

export default function InstancedBuild(props) {
  // Load map model
  const { scene } = useThree();
  const infinityBuildModel = useGLTF("./InfinityBuild.glb");
  const instancedMeshRef = useRef();
  const temp = new THREE.Object3D();

  useEffect(() => {
    infinityBuildModel.materials.GridTexture.side = THREE.FrontSide;
  }, [infinityBuildModel]);

  // Instance mesh position preset
  const count = 1000;
  const scale = 1;
  useEffect(() => {

    for (let i = 0; i < count; i++) {
      temp.position.set(0, -4 * i, 0);
      temp.rotation.set(0, 0, 0); //-Math.PI / 2
      temp.scale.set(scale, scale, scale);
      temp.updateMatrix();

      instancedMeshRef.current.setMatrixAt(i, temp.matrix);
    }

    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group {...props} dispose={null}>
      <instancedMesh
        castShadow
        receiveShadow
        ref={instancedMeshRef}
        args={[
          infinityBuildModel.nodes.Combine003.geometry,
          infinityBuildModel.materials.GridTexture,
          count,
        ]}
      />
    </group>
  );
}

useGLTF.preload("./SongBuild.glb");
