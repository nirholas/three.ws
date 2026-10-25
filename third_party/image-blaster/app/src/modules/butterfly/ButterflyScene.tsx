import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BoidsFlock } from './BoidsFlock'

const CAMERA_FORWARD_DISTANCE = 1.5
const _cameraForward = new THREE.Vector3()

export function ButterflyScene() {
  const camera = useThree((state) => state.camera)
  const targetRef = useRef(new THREE.Vector3())
  const intensityRef = useRef(0.25)

  useFrame(() => {
    camera.getWorldDirection(_cameraForward)
    targetRef.current.copy(camera.position).addScaledVector(_cameraForward, CAMERA_FORWARD_DISTANCE)
  })

  return (
    <BoidsFlock
      targetRef={targetRef}
      intensityRef={intensityRef}
    />
  )
}
