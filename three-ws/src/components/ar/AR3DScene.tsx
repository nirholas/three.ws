"use client";

import { Suspense, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import Ecctrl, { useJoystickControls, type CustomEcctrlRigidBody } from "ecctrl";
import * as THREE from "three";
import type { JoystickVector } from "./useJoystick";
import type { AvatarVariant } from "./Avatar";
import { Character3D } from "./Character3D";

export interface AR3DSceneHandle {
  /** Underlying WebGL canvas — used by photo capture to composite over the camera feed. */
  glCanvas: HTMLCanvasElement | null;
  /** Current character world position (mutates in place). */
  posRef: React.MutableRefObject<THREE.Vector3>;
}

interface AR3DSceneProps {
  variant: AvatarVariant;
  vectorRef: React.MutableRefObject<JoystickVector>;
  /** Called when the character's screen position changes (throttled). */
  onScreenPos?: (sx: number, sy: number) => void;
}

const FLOOR_Y = -0.7;

/**
 * Feeds the custom on-screen joystick's normalized {dx, dy} vector into
 * ecctrl's joystick store every frame.
 *
 *   dy < 0 (push up) → forward → angle = π/2
 *   dx > 0 (push right) → angle = 0
 */
function JoystickBridge({ vectorRef }: { vectorRef: React.MutableRefObject<JoystickVector> }) {
  const setJoystick = useJoystickControls((s) => s.setJoystick);
  const resetJoystick = useJoystickControls((s) => s.resetJoystick);
  const wasActive = useRef(false);

  useFrame(() => {
    const { dx, dy } = vectorRef.current;
    const mag = Math.min(1, Math.hypot(dx, dy));
    if (mag < 0.08) {
      if (wasActive.current) {
        resetJoystick();
        wasActive.current = false;
      }
      return;
    }
    const angle = Math.atan2(-dy, dx);
    const normAngle = angle < 0 ? angle + Math.PI * 2 : angle;
    setJoystick(mag, normAngle, mag > 0.9);
    wasActive.current = true;
  });

  return null;
}

/** Reports the character's screen-space position back to the HUD. */
function PositionReporter({
  bodyRef,
  posRef,
  onScreenPos,
}: {
  bodyRef: React.MutableRefObject<CustomEcctrlRigidBody | null>;
  posRef: React.MutableRefObject<THREE.Vector3>;
  onScreenPos?: (sx: number, sy: number) => void;
}) {
  const { camera, size } = useThree();
  const tick = useRef(0);
  const v = useRef(new THREE.Vector3());

  useFrame(() => {
    const body = bodyRef.current?.group;
    if (!body) return;
    const t = body.translation();
    posRef.current.set(t.x, t.y, t.z);

    tick.current = (tick.current + 1) % 4;
    if (tick.current !== 0 || !onScreenPos) return;

    v.current.set(t.x, t.y + 0.4, t.z).project(camera);
    const sx = ((v.current.x + 1) / 2) * size.width;
    const sy = ((1 - v.current.y) / 2) * size.height;
    onScreenPos(sx, sy);
  });

  return null;
}

export const AR3DScene = forwardRef<AR3DSceneHandle, AR3DSceneProps>(function AR3DScene(
  { variant, vectorRef, onScreenPos },
  ref,
) {
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const bodyRef = useRef<CustomEcctrlRigidBody | null>(null);
  const posRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useImperativeHandle(ref, () => ({
    get glCanvas() {
      return glRef.current;
    },
    posRef,
  }));

  if (!mounted) return null;

  return (
    <Canvas
      className="absolute inset-0"
      shadows
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        glRef.current = gl.domElement;
        gl.setClearColor(0x000000, 0);
      }}
      camera={{ fov: 55, near: 0.1, far: 60, position: [0, 1.6, 3.2] }}
    >
      <Suspense fallback={null}>
        <hemisphereLight args={["#ffffff", "#3a2a1a", 0.55]} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[4, 7, 4]}
          intensity={1.4}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-4}
          shadow-camera-right={4}
          shadow-camera-top={4}
          shadow-camera-bottom={-4}
          shadow-camera-near={0.5}
          shadow-camera-far={20}
        />

        <Physics timeStep="vary" gravity={[0, -9.81, 0]}>
          <Ecctrl
            ref={bodyRef}
            position={[0, 1, 0]}
            capsuleHalfHeight={0.35}
            capsuleRadius={0.32}
            floatHeight={0.08}
            camInitDis={-3.4}
            camMinDis={-2.2}
            camMaxDis={-6}
            camInitDir={{ x: -0.18, y: 0 }}
            camListenerTarget="domElement"
            maxVelLimit={1.0}
            sprintMult={3.0}
            turnSpeed={14}
            turnVelMultiplier={1}
          >
            <Character3D variant={variant} />
          </Ecctrl>

          {/* Invisible ground — physics collider + shadow catcher */}
          <RigidBody type="fixed" colliders={false} position={[0, FLOOR_Y, 0]}>
            <CuboidCollider args={[40, 0.1, 40]} position={[0, -0.1, 0]} />
            <mesh rotation-x={-Math.PI / 2} receiveShadow>
              <planeGeometry args={[40, 40]} />
              <shadowMaterial transparent opacity={0.5} />
            </mesh>
          </RigidBody>
        </Physics>

        <JoystickBridge vectorRef={vectorRef} />
        <PositionReporter bodyRef={bodyRef} posRef={posRef} onScreenPos={onScreenPos} />
      </Suspense>
    </Canvas>
  );
});
