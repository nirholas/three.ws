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

const keyboardMap = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "leftward", keys: ["ArrowLeft", "KeyA"] },
  { name: "rightward", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
  { name: "run", keys: ["Shift"] },
];

export default function SimsExperience() {
  const camControlRef = useRef(null);
  const ecctrlRef = useRef(null);
  const colliderMeshesArray = useEcctrlStore(
    (state) => state.colliderMeshesArray
  );

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
      <Environment preset="apartment" environmentIntensity={0.6} />

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
        <CozyTavernMap position={[0, -3, 0]} />
      </StaticCollider>
    </>
  );
}
