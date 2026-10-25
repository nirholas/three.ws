import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useTexture, PositionalAudio } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import { useButterflyStore } from './store'
import { useAudioReady } from '../audio/useAudioReady'
import { useAudioStore } from '../../store/audio'

const GLB_URL = '/butterfly/butterfly-loop.glb'
const TEX_URLS = [
  '/butterfly/butterfly1.jpg',
  '/butterfly/butterfly2.jpg',
  '/butterfly/butterfly4.jpg',
  '/butterfly/butterfly5.jpg',
]
const FLAP_URLS = Array.from({ length: 8 }, (_, i) => `/butterfly/sfx/moth-flap-${i + 1}.wav`)

const MODEL_SCALE = 0.25
const SPEED_SMOOTH = 6 // 1/seconds, exponential damping for measured speed

interface Props {
  visible?: boolean
  withAudio?: boolean
  intensityRef?: React.RefObject<number>
}

export const Butterfly = forwardRef<THREE.Group, Props>(function Butterfly(
  { visible = true, withAudio = false, intensityRef },
  ref,
) {
  const { scene, animations } = useGLTF(GLB_URL)
  const [scale] = useState(MODEL_SCALE * (Math.random() * 0.25 + 0.75))
  const [textureUrl] = useState(() => TEX_URLS[Math.floor(Math.random() * TEX_URLS.length)])
  const texture = useTexture(textureUrl)

  const groupRef = useRef<THREE.Group>(null)
  useImperativeHandle(ref, () => groupRef.current as THREE.Group)

  const [flapUrl] = useState(() => FLAP_URLS[Math.floor(Math.random() * FLAP_URLS.length)])
  const [sinePhase] = useState(() => Math.random() * Math.PI * 2)
  const audioRef = useRef<THREE.PositionalAudio>(null)
  const audioReady = useAudioReady()
  const flapMixRef = useRef(0)
  const tRef = useRef(0)

  const lastPos = useRef(new THREE.Vector3())
  const smoothedSpeed = useRef(0)
  const seededRef = useRef(false)

  const { clone, mixer, speedMul, material } = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene) as THREE.Group
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.25,
    })
    cloned.traverse((c) => {
      const mesh = c as THREE.Mesh
      if (mesh.isMesh) mesh.material = mat
    })
    const m = new THREE.AnimationMixer(cloned)
    if (animations.length > 0) {
      const clip = animations[0]
      const action = m.clipAction(clip)
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.clampWhenFinished = false
      action.play()
      m.update(Math.random() * clip.duration)
    }
    return { clone: cloned, mixer: m, speedMul: 0.7 + Math.random() * 0.6, material: mat }
  }, [scene, animations, texture])

  useEffect(() => () => {
    mixer.stopAllAction()
    material.dispose()
  }, [material, mixer])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const g = groupRef.current
    if (g) {
      if (!seededRef.current) {
        lastPos.current.copy(g.position)
        seededRef.current = true
      }
      const inst = g.position.distanceTo(lastPos.current) / Math.max(dt, 1e-4)
      lastPos.current.copy(g.position)
      const a = 1 - Math.exp(-SPEED_SMOOTH * dt)
      smoothedSpeed.current += (inst - smoothedSpeed.current) * a
    }

    const p = useButterflyStore.getState()
    const flapMul = p.flapSpeedBase + p.flapSpeedVelScale * smoothedSpeed.current
    mixer.update(dt * speedMul * flapMul)

    if (audioRef.current) {
      tRef.current += dt
      const intensity = Math.max(0, Math.min(1, intensityRef?.current ?? 0))
      const k = 1 - Math.exp(-p.flapMoveLerp * dt)
      flapMixRef.current += (intensity - flapMixRef.current) * k
      const sine = 0.5 + 0.5 * Math.sin(tRef.current * p.flapSineFreq + sinePhase)
      const env = 1 - p.flapSineDepth + p.flapSineDepth * sine
      const muted = useAudioStore.getState().muted
      audioRef.current.setVolume(muted ? 0 : flapMixRef.current * env * p.flapVolume)
      audioRef.current.setRefDistance(p.flapRefDistance)
    }
  })

  return (
    <group ref={groupRef} visible={visible}>
      <group scale={scale} rotation={[Math.PI * .05, Math.PI * .5, 0]}>
        <primitive object={clone} />
      </group>
      {audioReady && withAudio && (
        <PositionalAudio
          ref={audioRef}
          url={flapUrl}
          distance={useButterflyStore.getState().flapRefDistance}
          loop
          autoplay
        />
      )}
    </group>
  )
})

useGLTF.preload(GLB_URL)
TEX_URLS.forEach((url) => useTexture.preload(url))
