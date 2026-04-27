import * as THREE from "three";
import { useEffect, useRef, useState } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useAnimationStore } from "../src";
import { SkeletonUtils } from "three-stdlib";

const DEFAULT_AGENT_GLB =
  new URLSearchParams(window.location.search).get("glb") ||
  "/Floating Character.glb";
const ANIMATION_LIBRARY_URL = "/AnimationLibrary.glb";

const statusToActionMap = {
  IDLE: "Idle_Loop",
  WALK: "Walk_Loop",
  RUN: "Jog_Fwd_Loop",
  JUMP_START: "Jump_Start",
  JUMP_IDLE: "Jump_Loop",
  JUMP_FALL: "Jump_Loop",
  JUMP_LAND: "Jump_Land",
};

export default function AgentCharacterModel(props) {
  const slowMotion = props.slowMotion ?? 1;
  const prevActionNameRef = useRef("Idle_Loop");
  const [canPlayNext, setCanPlayNext] = useState(true);

  const { scene: agentScene } = useGLTF(DEFAULT_AGENT_GLB);
  const { animations } = useGLTF(ANIMATION_LIBRARY_URL);

  const cloned = useRef();
  if (!cloned.current) {
    cloned.current = SkeletonUtils.clone(agentScene);
    cloned.current.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  const { ref, actions, mixer } = useAnimations(animations);
  const actionStore = useAnimationStore((state) => state.animationStatus);

  useEffect(() => {
    const nextActionName = statusToActionMap[actionStore];
    const nextAction = actions[nextActionName];
    if (!nextAction) return;

    const prevActionName = prevActionNameRef.current;
    if (nextActionName !== prevActionName && canPlayNext) {
      if (
        nextActionName === statusToActionMap.JUMP_START ||
        nextActionName === statusToActionMap.JUMP_LAND
      ) {
        setCanPlayNext(false);
        nextAction.timeScale = 1.6;
        nextAction
          .reset()
          .crossFadeFrom(actions[prevActionName], 0.1)
          .setLoop(THREE.LoopOnce, 1)
          .play();
        nextAction.clampWhenFinished = true;
      } else {
        setCanPlayNext(true);
        nextAction.timeScale = 1;
        nextAction.reset().crossFadeFrom(actions[prevActionName], 0.2).play();
      }
      prevActionNameRef.current = nextActionName;
    }

    if (
      !canPlayNext &&
      prevActionName === statusToActionMap.JUMP_START &&
      actionStore !== "JUMP_IDLE" &&
      actionStore !== "JUMP_START"
    ) {
      setCanPlayNext(true);
    }
    if (
      !canPlayNext &&
      prevActionName === statusToActionMap.JUMP_LAND &&
      actionStore !== "IDLE" &&
      actionStore !== "JUMP_LAND"
    ) {
      setCanPlayNext(true);
    }
  }, [actionStore, canPlayNext]);

  useEffect(() => {
    const onFinished = (e) => {
      if (
        !canPlayNext &&
        (e.action._clip.name === statusToActionMap.JUMP_START ||
          e.action._clip.name === statusToActionMap.JUMP_LAND)
      ) {
        setCanPlayNext(true);
      }
    };
    mixer.addEventListener("finished", onFinished);
    return () => mixer.removeEventListener("finished", onFinished);
  }, [canPlayNext]);

  useEffect(() => {
    mixer.timeScale = props.paused ? 0 : slowMotion;
  }, [props.paused, slowMotion]);

  return (
    <group
      ref={ref}
      dispose={null}
      position={[0, -1.1, 0]}
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("sims:agent-click"));
      }}
    >
      <primitive object={cloned.current} />
    </group>
  );
}

useGLTF.preload(DEFAULT_AGENT_GLB);
useGLTF.preload(ANIMATION_LIBRARY_URL);
