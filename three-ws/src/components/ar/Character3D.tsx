"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useJoystickControls } from "ecctrl";
import * as THREE from "three";
import type { AvatarVariant } from "./Avatar";

const VARIANT_GLBS: Record<AvatarVariant, string> = {
  rosie: "/avatars/cz.glb",
  void: "/avatars/default.glb",
  moss: "/avatars/cz.glb",
  sun: "/avatars/default.glb",
};

const LOCOMOTION_URL = "/animations/soldier.glb";

useGLTF.preload("/avatars/cz.glb");
useGLTF.preload("/avatars/default.glb");
useGLTF.preload(LOCOMOTION_URL);

interface Character3DProps {
  variant: AvatarVariant;
}

/**
 * Soldier rig uses Mixamo bone names ("mixamorig:Hips"). CZ/default rigs use
 * plain names ("Hips"). Stripping the prefix on every track makes the clips
 * drive the avatar's skeleton by matching bone names.
 *
 * Also drops the Hips position track — ecctrl owns body position, so we only
 * want the clips to animate joint rotations.
 */
function retargetMixamoClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const retargeted = clip.clone();
  retargeted.tracks = clip.tracks
    .map((t) => {
      const next = t.clone();
      next.name = next.name.replace(/^mixamorig:?/, "");
      return next;
    })
    .filter((t) => !/^Hips\.position$/.test(t.name));
  return retargeted;
}

export function Character3D({ variant }: Character3DProps) {
  const url = VARIANT_GLBS[variant];
  const { scene } = useGLTF(url);
  const { animations: locomotionRaw } = useGLTF(LOCOMOTION_URL);
  const ref = useRef<THREE.Group>(null);

  const clips = useMemo(
    () => locomotionRaw.filter((c) => c.name !== "TPose").map(retargetMixamoClip),
    [locomotionRaw],
  );

  const { actions } = useAnimations(clips, ref);
  const getJoystickValues = useJoystickControls((s) => s.getJoystickValues);
  const currentName = useRef<string | null>(null);

  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [scene]);

  useFrame(() => {
    const { joystickDis, runState } = getJoystickValues();
    const next = joystickDis < 0.1 ? "Idle" : runState ? "Run" : "Walk";
    if (next === currentName.current) return;

    const prev = currentName.current ? actions[currentName.current] : null;
    const target = actions[next];
    if (!target) return;
    target.reset().fadeIn(0.25).play();
    if (prev && prev !== target) prev.fadeOut(0.25);
    currentName.current = next;
  });

  // Scale 0.6 fits the avatar inside the existing capsule (~1m total height).
  // Y offset lifts the model origin (which sits at the feet for Mixamo-style
  // rigs) down to the capsule's physical bottom so feet plant on the ground.
  return <primitive ref={ref} object={scene} scale={0.6} position={[0, -0.5, 0]} />;
}
