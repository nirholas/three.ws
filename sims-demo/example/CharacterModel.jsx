import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

export default function CharacterModel(props) {
  const { nodes, materials } = useGLTF("/capsule.glb");
  materials.GridTexture.side = THREE.FrontSide;
  materials.GridTexture.color.setHex("0xE6E6FA");

  return (
    <mesh
      {...props}
      castShadow
      receiveShadow
      position={[0, -0.6, 0]}
      geometry={nodes.Capsule.geometry}
      material={materials.GridTexture}
    />
  );
}

useGLTF.preload("/capsule.glb");
