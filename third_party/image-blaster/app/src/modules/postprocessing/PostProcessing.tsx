import { useEffect, useMemo } from 'react'
import { EffectComposer } from '@react-three/postprocessing'
import { BlendFunction, BloomEffect, ChromaticAberrationEffect, KernelSize, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MotionBlurEffect } from './MotionBlurEffect'
import { useDebugStore } from '../../store/debug'

const _prevQuat = new THREE.Quaternion()
const _prevForward = new THREE.Vector3()
const _currentForward = new THREE.Vector3()
const _deltaForward = new THREE.Vector3()
const _cameraRight = new THREE.Vector3()
const _cameraUp = new THREE.Vector3()

function OptionalEffect({ enabled, object }: { enabled: boolean; object: object }) {
  return enabled ? <primitive object={object} /> : null
}

// Why we instantiate effects directly instead of using <Bloom>/<ChromaticAberration>:
// @react-three/postprocessing's wrapEffect uses `useMemo(..., [JSON.stringify(a)])`
// where `a` is the rest-spread of props. In React 19, `ref` is a regular prop, so
// once the ref populates with the effect instance, JSON.stringify recurses through
// the BloomEffect's render targets/textures and hits circular parent/children refs.
// Mounting effects via <primitive> bypasses that path entirely.
export function PostProcessing() {
  const { camera } = useThree()
  const bloomEnabled = useDebugStore((s) => s.bloomEnabled)
  const chromaticEnabled = useDebugStore((s) => s.chromaticEnabled)
  const motionBlurEnabled = useDebugStore((s) => s.motionBlurEnabled)

  const bloomEffect = useMemo(() => {
    const initial = useDebugStore.getState()
    return new BloomEffect({
      intensity: initial.bloomIntensity,
      luminanceThreshold: initial.bloomThreshold,
      luminanceSmoothing: 0.9,
      blendFunction: BlendFunction.ADD,
      kernelSize: KernelSize.MEDIUM,
      mipmapBlur: false,
      resolutionScale: 0.35,
    })
  }, [])

  const chromaEffect = useMemo(() => {
    const initial = useDebugStore.getState()
    return new ChromaticAberrationEffect({
      offset: new THREE.Vector2(initial.chromaticOffset, initial.chromaticOffset),
      radialModulation: false,
      modulationOffset: 0,
      blendFunction: BlendFunction.NORMAL,
    })
  }, [])

  const blurEffect = useMemo(() => new MotionBlurEffect(), [])
  const toneMappingEffect = useMemo(() => new ToneMappingEffect({
    mode: ToneMappingMode.LINEAR,
    blendFunction: BlendFunction.SRC,
  }), [])

  useEffect(() => {
    _prevQuat.copy(camera.quaternion)
    camera.getWorldDirection(_prevForward)
  }, [camera])

  useEffect(() => {
    return () => {
      bloomEffect.dispose()
      chromaEffect.dispose()
      blurEffect.dispose()
      toneMappingEffect.dispose()
    }
  }, [bloomEffect, chromaEffect, blurEffect, toneMappingEffect])

  useFrame(() => {
    const s = useDebugStore.getState()

    const intensityUniform = bloomEffect.uniforms.get('intensity')
    if (intensityUniform) intensityUniform.value = s.bloomIntensity
    bloomEffect.luminanceMaterial.threshold = s.bloomThreshold

    chromaEffect.offset.set(s.chromaticOffset, s.chromaticOffset)

    camera.getWorldDirection(_currentForward)
    _deltaForward.copy(_currentForward).sub(_prevForward)
    _cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
    _cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion)

    const x = _deltaForward.dot(_cameraRight)
    const y = _deltaForward.dot(_cameraUp)
    const angle = _deltaForward.length()
    const strength = Math.min(angle * s.motionBlurStrength * 8, 1)
    blurEffect.setVelocity(x * 0.5, y * 0.5, strength)
    _prevQuat.copy(camera.quaternion)
    _prevForward.copy(_currentForward)
  })

  const hasEffects = bloomEnabled || chromaticEnabled || motionBlurEnabled
  if (!hasEffects) return null

  const effectKey = [
    bloomEnabled ? 'bloom' : '',
    chromaticEnabled ? 'chroma' : '',
    motionBlurEnabled ? 'blur' : '',
  ].join('|')

  return (
    <EffectComposer key={effectKey} multisampling={0}>
      <OptionalEffect key="blur" enabled={motionBlurEnabled} object={blurEffect} />
      <OptionalEffect key="bloom" enabled={bloomEnabled} object={bloomEffect} />
      <OptionalEffect key="chroma" enabled={chromaticEnabled} object={chromaEffect} />
      <primitive key="tone-mapping" object={toneMappingEffect} />
    </EffectComposer>
  )
}
