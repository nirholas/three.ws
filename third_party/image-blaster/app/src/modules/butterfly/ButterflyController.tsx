import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  RigidBody,
  BallCollider,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier'
import * as THREE from 'three'
import { useButterflyInput } from './useButterflyInput'
import { OrbitCamera } from './OrbitCamera'
import { BoidsFlock, type BoidsFlockHandle } from './BoidsFlock'
import { AmbientAudio } from './AmbientAudio'
import { WindAudio } from './WindAudio'
import { useButterflyStore } from './store'

interface MarkerProps {
  posRef: React.RefObject<THREE.Vector3>
  color: number
}

function DebugMarker({ posRef, color }: MarkerProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (meshRef.current && posRef.current) meshRef.current.position.copy(posRef.current)
  })
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.03, 6, 4]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  )
}

export interface ButterflyControllerHandle {
  reset: () => void
}

const _forward = new THREE.Vector3()
const _right = new THREE.Vector3()
const _move = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const DEFAULT_SPAWN = new THREE.Vector3(0, 1, -0.5)

export const ButterflyController = forwardRef<ButterflyControllerHandle>(
  function ButterflyController(_props, ref) {
    const bodyRef = useRef<RapierRigidBody>(null)
    const flockRef = useRef<BoidsFlockHandle>(null)
    const { camera } = useThree()
    const input = useButterflyInput()
    const showDebug = useButterflyStore((s) => s.showDebug)
    const { world } = useRapier()
    type CharCtrl = ReturnType<typeof world.createCharacterController>
    const controllerRef = useRef<CharCtrl | null>(null)

    useEffect(() => {
      const c = world.createCharacterController(0.01)
      c.setSlideEnabled(true)
      c.enableAutostep(0, 0, false)
      c.disableSnapToGround()
      c.setApplyImpulsesToDynamicBodies(true)
      controllerRef.current = c
      return () => {
        try {
          world.removeCharacterController(c)
        } catch {
          // The Rapier world may already be tearing down during route changes.
        }
        controllerRef.current = null
      }
    }, [world])

    const targetPos = useRef(DEFAULT_SPAWN.clone())
    const pivotPos = useRef(DEFAULT_SPAWN.clone())
    const flockCentroid = useRef(new THREE.Vector3())
    const cameraPosRef = useRef(new THREE.Vector3())
    const moveIntensityRef = useRef(0)
    const angularIntensityRef = useRef(0)
    const prevYawRef = useRef(0)
    const prevPitchRef = useRef(0)
    const prevSeededRef = useRef(false)

    const reset = () => {
      const params = useButterflyStore.getState()
      targetPos.current.copy(DEFAULT_SPAWN)
      pivotPos.current.copy(DEFAULT_SPAWN)
      input.yaw.current = params.defaultYaw
      input.pitch.current = params.defaultPitch
      input.distance.current = params.defaultDistance
      input.targetDistance.current = params.defaultDistance
      input.keys.current.clear()
      input.touchMoveVec.current.x = 0
      input.touchMoveVec.current.y = 0
      bodyRef.current?.setTranslation(DEFAULT_SPAWN, true)
      bodyRef.current?.setLinvel({ x: 0, y: 0, z: 0 }, true)
      flockRef.current?.reset(targetPos.current)
    }

    useImperativeHandle(ref, () => ({ reset }))

    useFrame((_, dtRaw) => {
      const body = bodyRef.current
      if (!body) return
      const dt = Math.min(dtRaw, 0.05)
      const params = useButterflyStore.getState()

      let fwdAmt = 0
      let rightAmt = 0
      let upAmt = 0
      let yawAmt = 0
      const k = input.keys.current
      if (k.has('KeyW') || k.has('ArrowUp')) fwdAmt += 1
      if (k.has('KeyS') || k.has('ArrowDown')) fwdAmt -= 1
      if (k.has('KeyA') || k.has('ArrowLeft')) yawAmt += 1
      if (k.has('KeyD') || k.has('ArrowRight')) yawAmt -= 1
      if (k.has('KeyE')) upAmt += 1
      if (k.has('KeyQ')) upAmt -= 1

      rightAmt += input.touchMoveVec.current.x
      fwdAmt += input.touchMoveVec.current.y

      if (yawAmt !== 0) input.yaw.current += yawAmt * params.rotationSpeed * dt

      camera.getWorldDirection(_forward)
      _right.copy(_forward).cross(_up).normalize()

      _move
        .set(0, 0, 0)
        .addScaledVector(_forward, fwdAmt)
        .addScaledVector(_right, rightAmt)

      if (_move.lengthSq() > 1) _move.normalize()
      _move.multiplyScalar(params.flightSpeed)
      _move.y += upAmt * params.flightSpeed

      const cur = body.translation()
      const desired = { x: _move.x * dt, y: _move.y * dt, z: _move.z * dt }

      const controller = controllerRef.current
      const collider = body.collider(0)
      let corrected = desired
      if (controller && collider) {
        controller.computeColliderMovement(collider, desired)
        corrected = controller.computedMovement()
      }

      const nx = cur.x + corrected.x
      const ny = cur.y + corrected.y
      const nz = cur.z + corrected.z
      body.setNextKinematicTranslation({ x: nx, y: ny, z: nz })
      targetPos.current.set(nx, ny, nz)
      cameraPosRef.current.copy(camera.position)

      const inputMag = Math.min(
        1,
        Math.hypot(fwdAmt, rightAmt, upAmt) + Math.abs(yawAmt) * 0.5,
      )
      moveIntensityRef.current = inputMag

      if (!prevSeededRef.current) {
        prevYawRef.current = input.yaw.current
        prevPitchRef.current = input.pitch.current
        prevSeededRef.current = true
      }
      const dy = input.yaw.current - prevYawRef.current
      const dp = input.pitch.current - prevPitchRef.current
      prevYawRef.current = input.yaw.current
      prevPitchRef.current = input.pitch.current
      const angSpeed = Math.hypot(dy, dp) / Math.max(dt, 1e-4)
      const angIntensity = Math.min(1, angSpeed / Math.max(0.0001, params.windAngularThreshold))
      angularIntensityRef.current = angIntensity
    })

    return (
      <>
        <RigidBody
          ref={bodyRef}
          type="kinematicPosition"
          position={DEFAULT_SPAWN}
          colliders={false}
        >
          <BallCollider args={[useButterflyStore.getState().targetRadius]} />
          {showDebug && (
            <mesh>
              <sphereGeometry args={[useButterflyStore.getState().targetRadius, 8, 5]} />
              <meshBasicMaterial color={0xffff00} wireframe transparent opacity={0.4} />
            </mesh>
          )}
        </RigidBody>
        <OrbitCamera input={input} targetRef={targetPos} pivotRef={pivotPos} />
        <BoidsFlock
          ref={flockRef}
          targetRef={targetPos}
          centroidRef={flockCentroid}
          intensityRef={moveIntensityRef}
        />
        <AmbientAudio />
        <WindAudio angularIntensityRef={angularIntensityRef} />
        {showDebug && (
          <>
            <DebugMarker posRef={targetPos} color={0xffff00} />
            <DebugMarker posRef={cameraPosRef} color={0xff0000} />
            <DebugMarker posRef={flockCentroid} color={0x00ff00} />
            <mesh position={[-0.15, 1, 0]}>
              <sphereGeometry args={[0.1, 32, 32]} />
              <meshStandardMaterial color={0xffffff} metalness={1} roughness={0} />
            </mesh>
            <mesh position={[0.15, 1, 0]}>
              <sphereGeometry args={[0.1, 32, 32]} />
              <meshStandardMaterial color={0x808080} metalness={0} roughness={1} />
            </mesh>
          </>
        )}
      </>
    )
  },
)
