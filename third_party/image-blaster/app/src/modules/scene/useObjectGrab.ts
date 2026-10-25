import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ThreeEvent, useThree } from '@react-three/fiber'
import { type RapierRigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { markObjectInteraction } from '../interaction/pointerGuards'
import { SCENE_OBJECT_INSTANCE_ID_KEY, type SceneObjectHandle } from './SceneObject'

const GRAB_LINEAR_SPEED_LIMIT = 5 
const GRAB_ANGULAR_SPEED_LIMIT = 10

type ObjectRefMap = Map<string, RefObject<SceneObjectHandle | null>>

interface UseObjectGrabArgs {
  anchorRef: RefObject<RapierRigidBody | null>
  objectRefs: RefObject<ObjectRefMap>
  isObjectEligible?: (objectId: string) => boolean
}

interface ActiveGrab {
  objectId: string
  body: RapierRigidBody
  pointerId: number
  depth: number
  pointerNdc: THREE.Vector2
  target: THREE.Vector3
  previousTarget: THREE.Vector3
  releaseVelocity: THREE.Vector3
}

const _raycaster = new THREE.Raycaster()
const _grabDepthVector = new THREE.Vector3()
const _bodyPosition = new THREE.Vector3()
const _bodyRotation = new THREE.Quaternion()
const _inverseBodyRotation = new THREE.Quaternion()
const _localAnchor = new THREE.Vector3()
const _bodyLinearVelocity = new THREE.Vector3()
const _bodyAngularVelocity = new THREE.Vector3()
const _objectCenter = new THREE.Vector3()
const _projectedObjectCenter = new THREE.Vector3()
const _zeroVector = { x: 0, y: 0, z: 0 }

interface PointerTarget {
  objectId: string
  handle: SceneObjectHandle
  point: THREE.Vector3
  centerDistanceSq: number
  hitDistance: number
}

function isBodyUsable(body: RapierRigidBody | null | undefined): body is RapierRigidBody {
  if (!body) return false
  try {
    body.translation()
    return true
  } catch {
    return false
  }
}

function vectorLike(vector: THREE.Vector3) {
  return { x: vector.x, y: vector.y, z: vector.z }
}

function quaternionLike(quaternion: THREE.Quaternion) {
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }
}

function objectIdFromIntersectionObject(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object
  while (current) {
    const objectId = current.userData[SCENE_OBJECT_INSTANCE_ID_KEY]
    if (typeof objectId === 'string') return objectId
    current = current.parent
  }
  return null
}

function centerDistanceSqToPointer(event: ThreeEvent<PointerEvent>, center: THREE.Vector3, camera: THREE.Camera) {
  _projectedObjectCenter.copy(center).project(camera)
  return (
    (_projectedObjectCenter.x - event.pointer.x) ** 2 +
    (_projectedObjectCenter.y - event.pointer.y) ** 2
  )
}

function computePointerNdc(element: HTMLElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect()
  return new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
}

function computeLocalAnchor(body: RapierRigidBody, worldPoint: THREE.Vector3) {
  const translation = body.translation()
  const rotation = body.rotation()

  _bodyPosition.set(translation.x, translation.y, translation.z)
  _bodyRotation.set(rotation.x, rotation.y, rotation.z, rotation.w)
  _inverseBodyRotation.copy(_bodyRotation).invert()

  return _localAnchor.copy(worldPoint).sub(_bodyPosition).applyQuaternion(_inverseBodyRotation).clone()
}

function clampBodyVelocity(body: RapierRigidBody) {
  let linear
  let angular
  try {
    linear = body.linvel()
    angular = body.angvel()
  } catch {
    return false
  }
  _bodyLinearVelocity.set(linear.x, linear.y, linear.z)
  if (_bodyLinearVelocity.length() > GRAB_LINEAR_SPEED_LIMIT) {
    _bodyLinearVelocity.setLength(GRAB_LINEAR_SPEED_LIMIT)
    body.setLinvel(vectorLike(_bodyLinearVelocity), true)
  }

  _bodyAngularVelocity.set(angular.x, angular.y, angular.z)
  if (_bodyAngularVelocity.length() > GRAB_ANGULAR_SPEED_LIMIT) {
    _bodyAngularVelocity.setLength(GRAB_ANGULAR_SPEED_LIMIT)
    body.setAngvel(vectorLike(_bodyAngularVelocity), true)
  }
  return true
}

export function useObjectGrab({ anchorRef, objectRefs, isObjectEligible }: UseObjectGrabArgs) {
  const { camera, gl } = useThree()
  const { rapier, world } = useRapier()
  const [activeObjectId, setActiveObjectId] = useState<string | null>(null)
  const activeGrabRef = useRef<ActiveGrab | null>(null)
  const jointRef = useRef<ReturnType<typeof world.createImpulseJoint> | null>(null)
  const mountedRef = useRef(true)

  const setActiveObjectIdSafe = useCallback((objectId: string | null) => {
    if (mountedRef.current) setActiveObjectId(objectId)
  }, [])

  const removeJoint = useCallback(() => {
    const joint = jointRef.current
    if (!joint) return
    jointRef.current = null
    try {
      world.removeImpulseJoint(joint, true)
    } catch {
      // The Rapier world may already be unloading; stale joints can be ignored.
    }
  }, [world])

  const updatePointerTarget = useCallback(
    (grab: ActiveGrab) => {
      _raycaster.setFromCamera(grab.pointerNdc, camera)
      grab.target.copy(_raycaster.ray.origin).addScaledVector(_raycaster.ray.direction, grab.depth)
    },
    [camera],
  )

  const endGrab = useCallback(() => {
    const activeGrab = activeGrabRef.current
    if (!activeGrab) return

    removeJoint()

    if (isBodyUsable(activeGrab.body)) {
      const releaseVelocity = activeGrab.releaseVelocity.clone()
      if (releaseVelocity.length() > GRAB_LINEAR_SPEED_LIMIT) {
        releaseVelocity.setLength(GRAB_LINEAR_SPEED_LIMIT)
      }
      activeGrab.body.setLinvel(vectorLike(releaseVelocity), true)
      clampBodyVelocity(activeGrab.body)
      activeGrab.body.wakeUp()
    }

    try {
      if (gl.domElement.hasPointerCapture(activeGrab.pointerId)) {
        gl.domElement.releasePointerCapture(activeGrab.pointerId)
      }
    } catch {
      // Pointer capture may already be gone during canvas or route teardown.
    }

    activeGrabRef.current = null
    setActiveObjectIdSafe(null)
    markObjectInteraction()
  }, [gl.domElement, removeJoint, setActiveObjectIdSafe])

  const beginGrab = useCallback(
    (objectId: string, handle: SceneObjectHandle, pointerId: number, clientX: number, clientY: number, worldPoint: THREE.Vector3) => {
      const body = handle.rigidBody
      const anchor = anchorRef.current
      if (!isBodyUsable(body) || !isBodyUsable(anchor)) return

      endGrab()

      const pointerNdc = computePointerNdc(gl.domElement, clientX, clientY)
      _raycaster.setFromCamera(pointerNdc, camera)
      const depth = Math.max(_grabDepthVector.copy(worldPoint).sub(_raycaster.ray.origin).dot(_raycaster.ray.direction), 0.1)

      anchor.setTranslation(vectorLike(worldPoint), true)
      anchor.setNextKinematicTranslation(vectorLike(worldPoint))
      if (!clampBodyVelocity(body)) return
      body.wakeUp()

      const bodyAnchor = computeLocalAnchor(body, worldPoint)
      try {
        jointRef.current = world.createImpulseJoint(
          rapier.JointData.spherical(_zeroVector, vectorLike(bodyAnchor)),
          anchor,
          body,
          true,
        )
      } catch (error) {
        console.warn(`Could not create grab joint for "${objectId}".`, error)
        return
      }

      try {
        if (!gl.domElement.hasPointerCapture(pointerId)) {
          gl.domElement.setPointerCapture(pointerId)
        }
      } catch {
        removeJoint()
        return
      }

      activeGrabRef.current = {
        objectId,
        body,
        pointerId,
        depth,
        pointerNdc,
        target: worldPoint.clone(),
        previousTarget: worldPoint.clone(),
        releaseVelocity: new THREE.Vector3(),
      }
      setActiveObjectIdSafe(objectId)
    },
    [anchorRef, camera, endGrab, gl.domElement, rapier.JointData, removeJoint, setActiveObjectIdSafe, world],
  )

  const getPointerTarget = useCallback(
    (fallbackObjectId: string, event: ThreeEvent<PointerEvent>): PointerTarget | null => {
      const seenObjectIds = new Set<string>()
      let best: PointerTarget | null = null

      for (const intersection of event.intersections) {
        const objectId = objectIdFromIntersectionObject(intersection.object)
        if (!objectId || seenObjectIds.has(objectId)) continue
        seenObjectIds.add(objectId)
        if (isObjectEligible && !isObjectEligible(objectId)) continue

        const handle = objectRefs.current.get(objectId)?.current
        if (!handle || !isBodyUsable(handle.rigidBody)) continue

        const centerDistanceSq = centerDistanceSqToPointer(event, handle.getFocusPoint(_objectCenter), camera)
        const hitDistance = Number.isFinite(intersection.distance) ? intersection.distance : Number.POSITIVE_INFINITY
        if (
          !best ||
          centerDistanceSq < best.centerDistanceSq ||
          (centerDistanceSq === best.centerDistanceSq && hitDistance < best.hitDistance)
        ) {
          best = {
            objectId,
            handle,
            point: intersection.point.clone(),
            centerDistanceSq,
            hitDistance,
          }
        }
      }

      if (best) return best
      if (isObjectEligible && !isObjectEligible(fallbackObjectId)) return null

      const fallbackHandle = objectRefs.current.get(fallbackObjectId)?.current
      if (!fallbackHandle || !isBodyUsable(fallbackHandle.rigidBody)) return null
      return {
        objectId: fallbackObjectId,
        handle: fallbackHandle,
        point: event.point.clone(),
        centerDistanceSq: centerDistanceSqToPointer(event, fallbackHandle.getFocusPoint(_objectCenter), camera),
        hitDistance: event.distance,
      }
    },
    [camera, isObjectEligible, objectRefs],
  )

  const onPointerDown = useCallback(
    (objectId: string, event: ThreeEvent<PointerEvent>) => {
      if (event.button !== 0) return false
      const target = getPointerTarget(objectId, event)
      if (!target) return false

      event.stopPropagation()
      event.nativeEvent.preventDefault()
      markObjectInteraction()
      target.handle.playInteractionSfx()
      beginGrab(target.objectId, target.handle, event.pointerId, event.clientX, event.clientY, target.point)
      return true
    },
    [beginGrab, getPointerTarget],
  )

  const resetObjects = useCallback(() => {
    endGrab()
    for (const objectRef of objectRefs.current.values()) {
      const handle = objectRef.current
      const body = handle?.rigidBody
      if (!handle || !isBodyUsable(body)) continue

      body.setTranslation(vectorLike(handle.initialPosition), true)
      body.setRotation(quaternionLike(handle.initialRotation), true)
      body.setLinvel(_zeroVector, true)
      body.setAngvel(_zeroVector, true)
      body.wakeUp()
    }
  }, [endGrab, objectRefs])

  useBeforePhysicsStep((physicsWorld) => {
    const activeGrab = activeGrabRef.current
    const anchor = anchorRef.current
    if (!activeGrab) return
    if (!isBodyUsable(anchor) || !isBodyUsable(activeGrab.body)) {
      removeJoint()
      activeGrabRef.current = null
      setActiveObjectIdSafe(null)
      return
    }

    updatePointerTarget(activeGrab)
    const dt = physicsWorld.timestep || 1 / 60
    activeGrab.releaseVelocity.copy(activeGrab.target).sub(activeGrab.previousTarget).divideScalar(dt)
    if (activeGrab.releaseVelocity.length() > GRAB_LINEAR_SPEED_LIMIT) {
      activeGrab.releaseVelocity.setLength(GRAB_LINEAR_SPEED_LIMIT)
    }
    activeGrab.previousTarget.copy(activeGrab.target)
    anchor.setNextKinematicTranslation(vectorLike(activeGrab.target))
    clampBodyVelocity(activeGrab.body)
  })

  useAfterPhysicsStep(() => {
    const activeGrab = activeGrabRef.current
    if (!activeGrab) return
    if (!isBodyUsable(activeGrab.body)) {
      removeJoint()
      activeGrabRef.current = null
      setActiveObjectIdSafe(null)
      return
    }
    clampBodyVelocity(activeGrab.body)
  })

  useEffect(() => {
    mountedRef.current = true

    const onPointerMove = (event: PointerEvent) => {
      const activeGrab = activeGrabRef.current
      if (activeGrab && event.pointerId === activeGrab.pointerId) {
        activeGrab.pointerNdc.copy(computePointerNdc(gl.domElement, event.clientX, event.clientY))
        event.preventDefault()
        return
      }

    }

    const onPointerEnd = (event: PointerEvent) => {
      if (activeGrabRef.current?.pointerId === event.pointerId) {
        event.preventDefault()
        endGrab()
      }
    }

    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
    window.addEventListener('pointerup', onPointerEnd, { capture: true, passive: false })
    window.addEventListener('pointercancel', onPointerEnd, { capture: true, passive: false })
    return () => {
      window.removeEventListener('pointermove', onPointerMove, { capture: true })
      window.removeEventListener('pointerup', onPointerEnd, { capture: true })
      window.removeEventListener('pointercancel', onPointerEnd, { capture: true })
      endGrab()
      mountedRef.current = false
    }
  }, [endGrab, gl.domElement])

  return {
    activeObjectId,
    activeGrabRef,
    cancelGrab: endGrab,
    onPointerDown,
    resetObjects,
  }
}
