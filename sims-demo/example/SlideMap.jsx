import * as THREE from "three";

export default function SlideMap(props) {
  const material001 = props.model.materials.GridTexture.clone();
  material001.side = THREE.FrontSide;
  material001.color.setHex("0xADD8E6"); //0xF0F8FF //0xE0FFFF //0xFFE4E1

  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={props.model.nodes.Slide002.geometry}
        material={material001}
      />
    </group>
  );
}
