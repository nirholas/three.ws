import { useGLTF } from "@react-three/drei";

const TAVERN_URL = "/Cozy Tavern - First Floor 2.glb";

export default function CozyTavernMap(props) {
  const { scene } = useGLTF(TAVERN_URL);
  return (
    <group {...props} dispose={null}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(TAVERN_URL);
