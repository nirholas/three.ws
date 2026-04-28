import * as THREE from "three";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CameraControls,
  Environment,
  KeyboardControls,
} from "@react-three/drei";
import BVHEcctrl, {
  StaticCollider,
  useEcctrlStore,
} from "../src/index";
import Lights from "./Lights";
import AgentCharacterModel from "./AgentCharacterModel";
import CozyTavernMap from "./CozyTavernMap";
import LargeFloorMap from "./LargeFloorMap";
import HintzeHall from "./HintzeHall";
import InstancedMap from "./InstancedMap";
import { useGLTF } from "@react-three/drei";

function IbizoneMap(props) {
  const { scene } = useGLTF("./ibizone_2021_multiuse_location.glb");
  return <primitive object={scene} {...props} />;
}
useGLTF.preload("./ibizone_2021_multiuse_location.glb");

const keyboardMap = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "leftward", keys: ["ArrowLeft", "KeyA"] },
  { name: "rightward", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
  { name: "run", keys: ["Shift"] },
];

const MAP_CONFIG = {
  cozy_tavern: { component: CozyTavernMap, props: { position: [0, -3, 0] }, env: "apartment" },
  large_floor: { component: LargeFloorMap, props: {}, env: "city" },
  hintze_hall: { component: HintzeHall, props: { position: [0, -1, 0] }, env: "warehouse" },
  fantasy_inn: { component: InstancedMap, props: { position: [0, -1, 0] }, env: "forest" },
  ibizone: { component: IbizoneMap, props: { position: [0, 0, 0] }, env: "city" },
};

export default function SimsExperience({ mapName = "cozy_tavern" }) {
  const camControlRef = useRef(null);
  const ecctrlRef = useRef(null);
  const colliderMeshesArray = useEcctrlStore(
    (state) => state.colliderMeshesArray
  );

  const { component: MapComponent, props: mapProps, env } = MAP_CONFIG[mapName] ?? MAP_CONFIG.cozy_tavern;

  useFrame(() => {
    if (camControlRef.current && ecctrlRef.current?.group) {
      const p = ecctrlRef.current.group.position;
      camControlRef.current.moveTo(p.x, p.y + 0.6, p.z, true);
      if (ecctrlRef.current.model) {
        ecctrlRef.current.model.visible =
          camControlRef.current.distance > 0.7;
      }
    }
  });

  return (
    <>
      <CameraControls
        ref={camControlRef}
        smoothTime={0.15}
        colliderMeshes={colliderMeshesArray}
        makeDefault
      />
      <Lights />
      <Environment preset={env} environmentIntensity={0.6} />

      <KeyboardControls map={keyboardMap}>
        <BVHEcctrl
          ref={ecctrlRef}
          colliderCapsuleArgs={[0.3, 0.8, 4, 8]}
          maxWalkSpeed={1.5}
          maxRunSpeed={4.5}
        >
          <AgentCharacterModel />
        </BVHEcctrl>
      </KeyboardControls>

      <StaticCollider>
        <MapComponent {...mapProps} />
      </StaticCollider>
    </>
  );
}
