import * as THREE from "three"
import { CameraControls, Environment, Grid, KeyboardControls, OrbitControls, PointerLockControls, Stats, StatsGl, TransformControls, useGLTF, type CameraControlsProps } from "@react-three/drei";
import Lights from "./Lights";
import { useControls, folder, button } from "leva";
import CharacterModel from "./CharacterModel";
import React, { useEffect, useRef, useState } from "react";
import Map from "./Map";
import BVHEcctrl, { characterStatus, StaticCollider, KinematicCollider, InstancedStaticCollider, useEcctrlStore, useJoystickStore, type BVHEcctrlApi, type FloatCheckType } from "../src/index"
import { useFrame, useThree } from "@react-three/fiber";
import StaticMap from "./StaticMap";
import InstancedMap from "./InstancedMap";
import LargePlatform from "./LargePlatform";
import RotateBars from "./RotateBars";
import SlideMap from "./SlideMap";
import HintzeHall from "./HintzeHall";
import InstancedSong from "./InstancedSong";
import SongMap from "./SongMap";
import LargeFloorMap from "./LargeFloorMap";
import InstancedBuild from "./InstancedBuild";
import InfinityBuildRoof from "./InfinityBuildRoof";
import AnimatedCharaterModel from "./AnimatedCharacterModel";
import GeneralMap from "./GeneralMap"
import IKCharacterModel from "./IKCharacterModel";

export default function Experience() {
  /**
   * Load models
   */
  const testMapModel = useGLTF("/testMap.glb");
  // Retrieve collider meshes from store
  const colliderMeshesArray = useEcctrlStore((state) => state.colliderMeshesArray);

  /**
   * Initialize setup
   */
  const camControlRef = useRef<CameraControls | null>(null)
  const ecctrlRef = useRef<BVHEcctrlApi | null>(null)
  const kinematicCollderRef = useRef<THREE.Group | null>(null)
  const kinematicPlatformRef001 = useRef<THREE.Group | null>(null)
  const kinematicPlatformRef002 = useRef<THREE.Group | null>(null)
  const kinematicPlatformRef003 = useRef<THREE.Group | null>(null)
  const kinematicBarRef = useRef<THREE.Group | null>(null)

  /**
   * Debug settings
   */
  const EcctrlDebugSettings = useControls("Ecctrl Debug", {
    CameraLock: button(() => { camControlRef.current?.lockPointer() }),
    FirstPerson: button(() => { camControlRef.current?.dolly(camControlRef.current.distance - 0.02, true) }),
    ResetPlayer: button(() => {
      ecctrlRef.current?.group?.position.set(0, 0, 0);
      ecctrlRef.current?.resetLinVel()
    }),
    EcctrlDebug: false,
    Physics: folder({
      paused: false,
      delay: { value: 3, min: 0, max: 20, step: 0.1 },
      gravity: { value: 9.81, min: 0, max: 50, step: 0.1 },
      fallGravityFactor: { value: 4, min: 1, max: 10, step: 0.1 },
      maxFallSpeed: { value: 50, min: 1, max: 200, step: 1 },
      mass: { value: 1, min: 0.1, max: 10, step: 0.1 },
      sleepTimeout: { value: 10, min: 0, max: 100, step: 0.1 },
      slowMotionFactor: { value: 1, min: 0, max: 1, step: 0.01 },
    }, { collapsed: true }),
    Movement: folder({
      turnSpeed: { value: 15, min: 0, max: 100, step: 1 },
      maxWalkSpeed: { value: 1.1, min: 0, max: 10, step: 0.1 }, // 3
      maxRunSpeed: { value: 5.5, min: 0, max: 20, step: 0.1 }, // 5
      acceleration: { value: 26, min: 0, max: 100, step: 1 },
      deceleration: { value: 30, min: 0, max: 50, step: 1 }, // 15
      counterAccFactor: { value: 0.5, min: 0, max: 5, step: 0.1 },
      airDragFactor: { value: 0.3, min: 0, max: 1, step: 0.05 },
      jumpVel: { value: 6, min: 0, max: 20, step: 0.1 }, // 5
    }, { collapsed: true }),
    Floating: folder({
      floatCheckType: { value: "BOTH" as FloatCheckType, options: ["RAYCAST", "SHAPECAST", "BOTH"] as FloatCheckType[] },
      maxSlope: { value: 1, min: 0, max: Math.PI / 2, step: 0.01 },
      floatHeight: { value: 0.4, min: 0, max: 1, step: 0.01 }, // 0.25
      floatPullBackHeight: { value: 0.25, min: 0, max: 1, step: 0.01 },
      floatSensorRadius: { value: 0.12, min: 0, max: 1, step: 0.01 },
      floatSpringK: { value: 900, min: 0, max: 3000, step: 10 },
      floatDampingC: { value: 30, min: 0, max: 1000, step: 1 },
    }, { collapsed: true }),
    Collision: folder({
      collisionCheckIteration: { value: 3, min: 1, max: 10, step: 1 },
      collisionPushBackVelocity: { value: 3, min: 0, max: 50, step: 0.1 },
      collisionPushBackDamping: { value: 0.1, min: 0, max: 1, step: 0.05 },
      collisionPushBackThreshold: { value: 0.001, min: 0, max: 1, step: 0.01 },
    }, { collapsed: true }),
  })
  const EcctrlMapDebugSettings = useControls("Map Debug", {
    MapDebug: false,
    ActiveKinematicCollider: true,
    Map: folder({
      visible: true,
      excludeFloatHit: false,
      excludeCollisionCheck: false,
      friction: { value: 0.8, min: 0, max: 1, step: 0.01 },
      restitution: { value: 0.05, min: 0, max: 1, step: 0.01 },
    }, { collapsed: true }),
  })

  /**
   * Keyboard control preset
   */
  const keyboardMap = [
    { name: "forward", keys: ["ArrowUp", "KeyW"] },
    { name: "backward", keys: ["ArrowDown", "KeyS"] },
    { name: "leftward", keys: ["ArrowLeft", "KeyA"] },
    { name: "rightward", keys: ["ArrowRight", "KeyD"] },
    { name: "jump", keys: ["Space"] },
    { name: "run", keys: ["Shift"] },
  ];

  /**
   * Initialize kinematic colliders' position/rotation
   */
  useEffect(() => {
    if (kinematicPlatformRef001.current)
      kinematicPlatformRef001.current.position.z = 15
    if (kinematicPlatformRef002.current)
      kinematicPlatformRef002.current.position.z = 15
    if (kinematicPlatformRef003.current)
      kinematicPlatformRef003.current.position.z = 15
    if (kinematicBarRef.current) {
      kinematicBarRef.current.position.y = 5
      kinematicBarRef.current.position.z = 22
    }
  }, [])

  const elapsedTime = useRef(0)
  useFrame((state, delta) => {
    if (camControlRef.current && ecctrlRef.current) {
      // For camera control to follow character
      if (ecctrlRef.current.group)
        camControlRef.current.moveTo(
          ecctrlRef.current.group.position.x,
          ecctrlRef.current.group.position.y + 0.3,
          ecctrlRef.current.group.position.z,
          true
        )
      // Hide character model if camera is too close
      if (ecctrlRef.current.model)
        ecctrlRef.current.model.visible = camControlRef.current.distance > 0.7
    }

    // Animate kinematic platform
    if (EcctrlMapDebugSettings.ActiveKinematicCollider && !EcctrlDebugSettings.paused) {
      elapsedTime.current += delta * EcctrlDebugSettings.slowMotionFactor
      if (kinematicPlatformRef001.current)
        kinematicPlatformRef001.current.rotation.y = elapsedTime.current * 0.5
      if (kinematicPlatformRef002.current)
        kinematicPlatformRef002.current.position.x = 5 * Math.sin(elapsedTime.current) + 10
      if (kinematicPlatformRef003.current) {
        kinematicPlatformRef003.current.rotation.y = elapsedTime.current * 0.5
        kinematicPlatformRef003.current.position.x = 5 * Math.sin(elapsedTime.current * 0.5) - 10
      }
      if (kinematicBarRef.current) kinematicBarRef.current.rotation.z = elapsedTime.current * 0.2
    }
  })

  return (
    <>
      {/* <StatsGl /> */}

      <Stats />

      <CameraControls
        ref={camControlRef}
        smoothTime={0.1}
        colliderMeshes={colliderMeshesArray}
        makeDefault
      />

      <Lights />

      <Environment
        background
        blur={0.6}
        environmentIntensity={0.1}
        backgroundRotation={[0, -Math.PI / 2, 0]}
        files="/textures/sky.hdr"
      />

      {/* Keyboard preset */}
      <KeyboardControls map={keyboardMap}>
        {/* Character Control */}
        {/* <BVHEcctrl ref={ecctrlRef} debug={EcctrlDebugSettings.EcctrlDebug}>
          <CharacterModel />
        </BVHEcctrl> */}
        <BVHEcctrl
          ref={ecctrlRef}
          debug={EcctrlDebugSettings.EcctrlDebug}
          {...EcctrlDebugSettings}
          key={EcctrlDebugSettings.floatCheckType} // Force remount on change
          colliderCapsuleArgs={[0.3, 0.8, 4, 8]}
        >
          <AnimatedCharaterModel slowMotion={EcctrlDebugSettings.slowMotionFactor} paused={EcctrlDebugSettings.paused} />
        </BVHEcctrl>
        {/* <BVHEcctrl
          ref={ecctrlRef}
          debug={EcctrlDebugSettings.EcctrlDebug}
          floatHeight={0.3}
          colliderCapsuleArgs={[0.4, 0, 4, 8]}
          paused
        >
          <IKCharacterModel />
        </BVHEcctrl> */}
      </KeyboardControls>

      {/**
       * 
       * 
       * 
       * Stress test
       * 
       * 
       * 
       * 
       */}

      {/* Instanced mesh */}
      {/* <InstancedStaticCollider debug={EcctrlMapDebugSettings.MapDebug} {...EcctrlMapDebugSettings} >
        <InstancedBuild position={[0, -2, 0]} />
      </InstancedStaticCollider> */}

      {/* <InstancedStaticCollider debug={EcctrlMapDebugSettings.MapDebug} {...EcctrlMapDebugSettings} >
        <InstancedSong />
      </InstancedStaticCollider> */}

      {/* <InstancedStaticCollider debug={EcctrlMapDebugSettings.MapDebug} {...EcctrlMapDebugSettings} >
        <InstancedMap />
      </InstancedStaticCollider> */}

      {/* <StaticCollider debug>
        <InstancedMap />
      </StaticCollider> */}

      {/* Large model */}
      {/* <StaticCollider>
        <HintzeHall />
      </StaticCollider> */}

      {/**
       * 
       * 
       * 
       * Map models
       * 
       * 
       * 
       * 
       */}
      {/* Static Collider */}
      {/* <StaticCollider debug={EcctrlMapDebugSettings.MapDebug} {...EcctrlMapDebugSettings}>
        <InfinityBuildRoof position={[0, -2, 0]} />
      </StaticCollider> */}

      {/* <StaticCollider debug={EcctrlMapDebugSettings.MapDebug} {...EcctrlMapDebugSettings}>
        <LargeFloorMap position={[0, -2, 0]} />
      </StaticCollider> */}

      {/* <StaticCollider debug={EcctrlMapDebugSettings.MapDebug} {...EcctrlMapDebugSettings}>
        <SongMap />
      </StaticCollider> */}

      <StaticCollider debug={EcctrlMapDebugSettings.MapDebug} {...EcctrlMapDebugSettings}>
        <StaticMap model={testMapModel} position={[0, -3, 0]} />
      </StaticCollider>

      <StaticCollider debug={EcctrlMapDebugSettings.MapDebug} excludeFloatHit={true}>
        <SlideMap model={testMapModel} position={[0, 5, 22]} />
      </StaticCollider>

      {/* Moving Platform */}
      <KinematicCollider ref={kinematicPlatformRef001} debug={EcctrlMapDebugSettings.MapDebug} active={EcctrlMapDebugSettings.ActiveKinematicCollider}>
        <LargePlatform model={testMapModel} position={[0, -2.5, 0]} />
      </KinematicCollider>

      <KinematicCollider ref={kinematicPlatformRef002} debug={EcctrlMapDebugSettings.MapDebug} active={EcctrlMapDebugSettings.ActiveKinematicCollider}>
        <LargePlatform model={testMapModel} position={[0, -2.5, 0]} />
      </KinematicCollider>

      <KinematicCollider ref={kinematicPlatformRef003} debug={EcctrlMapDebugSettings.MapDebug} active={EcctrlMapDebugSettings.ActiveKinematicCollider}>
        <LargePlatform model={testMapModel} position={[0, -2.5, 0]} />
      </KinematicCollider>

      <KinematicCollider ref={kinematicBarRef} debug={EcctrlMapDebugSettings.MapDebug} active={EcctrlMapDebugSettings.ActiveKinematicCollider}>
        <RotateBars model={testMapModel} />
      </KinematicCollider>
    </>
  );
}

useGLTF.preload("/testMap.glb");