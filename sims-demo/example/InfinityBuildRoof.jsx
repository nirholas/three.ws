import { Outlines, useGLTF } from "@react-three/drei";
import { useEffect } from "react";
import * as THREE from "three";

export default function InfinityBuildRoof(props) {
  const infinityBuildModel = useGLTF("./InfinityBuild.glb");
  useEffect(() => {
    infinityBuildModel.materials.GridTexture.side = THREE.FrontSide;
  }, [infinityBuildModel]);

  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={infinityBuildModel.nodes.CombineRoof.geometry}
        material={infinityBuildModel.materials.GridTexture}
      />
    </group>
  );
}

useGLTF.preload("./InfinityBuild.glb");
