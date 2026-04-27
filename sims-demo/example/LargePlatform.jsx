import * as THREE from "three";

export default function LargePlatform(props) {
  const material001 = props.model.materials.GridTexture.clone();
  material001.side = THREE.FrontSide;
  material001.color.setHex("0xE6E6FA"); //0xF0F8FF //0xE0FFFF //0xFFE4E1

  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={props.model.nodes["4X4Platform"].geometry}
        material={material001}
      />
    </group>
  );
}
