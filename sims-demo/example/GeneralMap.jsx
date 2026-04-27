import { useGLTF } from "@react-three/drei";
import { useEffect } from "react";

export default function GeneralMap() {
  const map = useGLTF("./Cozy Tavern - First Floor 2.glb");
  useEffect(() => {
    map.scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [map]);

  return <primitive scale={1.5} object={map.scene} />;
}

useGLTF.preload("./Cozy Tavern - First Floor 2.glb");