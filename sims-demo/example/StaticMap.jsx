import { Outlines } from "@react-three/drei";
import * as THREE from "three";

export default function StaticMap(props) {
  // materials.GridTexture.side = THREE.FrontSide;
  const material001 = props.model.materials.GridTexture.clone();
  material001.color.setHex("0xE0FFFF"); //0xF0F8FF
  const material002 = props.model.materials.GridTexture.clone();
  material002.color.setHex("0xAFEEEE"); //#B0E0E6 //0xADD8E6 //0xAFEEEE

  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={props.model.nodes.Floor002.geometry}
        material={material001}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={props.model.nodes.Floor003.geometry}
        material={material002}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={props.model.nodes.SlopeStair002.geometry}
        material={material001}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={props.model.nodes.Slide.geometry}
        material={material001}
        position={[0, 8, 22]}
      />
    </group>
  );
}
