import { Outlines, useGLTF } from "@react-three/drei";
import { useEffect } from "react";
import * as THREE from "three";

export default function LargeFloorMap(props) {
  const largeFloorModel = useGLTF("./LargeFloor.glb");
  useEffect(() => {
    largeFloorModel.materials.GridTexture.side = THREE.FrontSide;
  }, [largeFloorModel]);

  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={largeFloorModel.nodes.LargeFloor.geometry}
        material={largeFloorModel.materials.GridTexture}
      />
    </group>
  );
}

useGLTF.preload("./LargeFloor.glb");
