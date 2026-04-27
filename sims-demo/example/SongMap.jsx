import { Outlines, useGLTF } from "@react-three/drei";
import { useEffect } from "react";
import * as THREE from "three";

export default function SongMap(props) {
  const songBuildModel = useGLTF("./SongBuild.glb");
  useEffect(() => {
    songBuildModel.materials.GridTexture.side = THREE.FrontSide;
  }, [songBuildModel]);

  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={songBuildModel.nodes.SongBuild.geometry}
        material={songBuildModel.materials.GridTexture}
      />
    </group>
  );
}

useGLTF.preload("./SongBuild.glb");
