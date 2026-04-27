import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useEffect } from "react";

export default function HintzeHall(props) {
  /**
   * Initialize
   */
  // Load map model
  const hintzeHallModel = useGLTF("./hintzeHallReal.glb", true);
  const hintzeHall4KModel = useGLTF("./hintzeHall4k.glb", true);

  //   useEffect(() => {
  //     hintzeHallModel.nodes.Sketchfab_Scene.traverse((child) => {
  //       if (child.isMesh) {
  //         child.receiveShadow = true;
  //       }
  //     });
  //   }, [hintzeHallModel]);

  return (
    <group {...props} dispose={null}>
      {/* <primitive
        object={hintzeHall4KModel.scene}
        rotation={[0, Math.PI / 2, 0]}
      /> */}
      <group>
        <mesh
          castShadow
          receiveShadow
          geometry={hintzeHallModel.nodes.Object_0.geometry}
          material={hintzeHallModel.materials.NHMHintzeHall02_Model_9_u2_v1}
        />
        <mesh
          castShadow
          receiveShadow
          geometry={hintzeHallModel.nodes.Object_0_1.geometry}
          material={hintzeHallModel.materials.NHMHintzeHall02_Model_9_u1_v1}
        />
        <mesh
          castShadow
          receiveShadow
          geometry={hintzeHallModel.nodes.Object_0_2.geometry}
          material={hintzeHallModel.materials.lambert4SG}
        />
      </group>
    </group>
  );
}

useGLTF.preload("./hintzeHallReal.glb");
useGLTF.preload("./hintzeHall4k.glb");
