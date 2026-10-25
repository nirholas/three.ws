import { Suspense, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useButterflyStore } from './store'
import { Butterfly } from './ButterflyModel'

const MAX_BOIDS = 100

export interface BoidsFlockHandle {
  reset: (centre: THREE.Vector3) => void
}

interface Props {
  targetRef: React.RefObject<THREE.Vector3>
  centroidRef?: React.RefObject<THREE.Vector3>
  intensityRef?: React.RefObject<number>
}

const _v = new THREE.Vector3()
const _sep = new THREE.Vector3()
const _ali = new THREE.Vector3()
const _coh = new THREE.Vector3()
const _att = new THREE.Vector3()
const _accel = new THREE.Vector3()
const _matrix = new THREE.Matrix4()
const _lookTarget = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _identityQuat = new THREE.Quaternion()
const _scaleVec = new THREE.Vector3()
const _targetQuat = new THREE.Quaternion()

export const BoidsFlock = forwardRef<BoidsFlockHandle, Props>(function BoidsFlock(
  { targetRef, centroidRef, intensityRef },
  ref,
) {
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const neighborMeshRef = useRef<THREE.InstancedMesh>(null)
  const sepMeshRef = useRef<THREE.InstancedMesh>(null)
  const lineRef = useRef<THREE.LineSegments>(null)
  const showDebug = useButterflyStore((s) => s.showDebug)

  const lineGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const positions = new Float32Array(MAX_BOIDS * 2 * 3)
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setDrawRange(0, 0)
    return g
  }, [])

  const state = useMemo(() => {
    const pos = new Float32Array(MAX_BOIDS * 3)
    const vel = new Float32Array(MAX_BOIDS * 3)
    const phase = new Float32Array(MAX_BOIDS * 8)
    for (let i = 0; i < MAX_BOIDS * 8; i++) {
      phase[i] = Math.random() * Math.PI * 2
    }
    return { pos, vel, phase }
  }, [])

  const reset = (centre: THREE.Vector3) => {
    const jitter = useButterflyStore.getState().spawnJitter
    for (let i = 0; i < MAX_BOIDS; i++) {
      state.pos[i * 3 + 0] = centre.x + (Math.random() - 0.5) * jitter
      state.pos[i * 3 + 1] = centre.y + (Math.random() - 0.5) * jitter
      state.pos[i * 3 + 2] = centre.z + (Math.random() - 0.5) * jitter
      state.vel[i * 3 + 0] = 0
      state.vel[i * 3 + 1] = 0
      state.vel[i * 3 + 2] = 0
    }
  }

  useImperativeHandle(ref, () => ({ reset }))

  useEffect(() => {
    reset(targetRef.current ?? new THREE.Vector3())
  }, [])

  const tRef = useRef(0)

  useFrame((_, dtRaw) => {
    const target = targetRef.current
    if (!target) return
    const dt = Math.min(dtRaw, 0.05)
    tRef.current += dt
    const t = tRef.current

    const p = useButterflyStore.getState()
    const n = Math.min(p.boidCount, MAX_BOIDS)
    if (p.paused) {
      updateDebugVisuals(state.pos, n, target, p.showDebug, p.neighborRadius, p.separationRadius)
      return
    }

    let cx = 0
    let cy = 0
    let cz = 0

    const nbr2 = p.neighborRadius * p.neighborRadius
    const sep2 = p.separationRadius * p.separationRadius

    for (let i = 0; i < n; i++) {
      const ix = i * 3
      const px = state.pos[ix + 0]
      const py = state.pos[ix + 1]
      const pz = state.pos[ix + 2]

      _sep.set(0, 0, 0)
      _ali.set(0, 0, 0)
      _coh.set(0, 0, 0)
      let nbrCount = 0

      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const jx = j * 3
        const dx = state.pos[jx + 0] - px
        const dy = state.pos[jx + 1] - py
        const dz = state.pos[jx + 2] - pz
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 >= nbr2 || d2 === 0) continue
        nbrCount++
        _ali.x += state.vel[jx + 0]
        _ali.y += state.vel[jx + 1]
        _ali.z += state.vel[jx + 2]
        _coh.x += state.pos[jx + 0]
        _coh.y += state.pos[jx + 1]
        _coh.z += state.pos[jx + 2]
        if (d2 < sep2) {
          const inv = 1 / Math.sqrt(d2)
          _sep.x -= dx * inv
          _sep.y -= dy * inv
          _sep.z -= dz * inv
        }
      }

      if (nbrCount > 0) {
        _ali.multiplyScalar(1 / nbrCount)
        _coh.multiplyScalar(1 / nbrCount).sub(_v.set(px, py, pz))
      }

      _att.set(target.x - px, target.y - py, target.z - pz)
      const attLen = _att.length()
      if (attLen > 0.0001) _att.multiplyScalar(1 / attLen)

      const phBase = i * 8
      const adhMul =
        1 + Math.sin(t * p.adherenceNoiseFreq + state.phase[phBase + 6]) * p.adherenceNoiseAmount
      const speedMul =
        1 + Math.sin(t * p.speedNoiseFreq + state.phase[phBase + 7]) * p.speedNoiseAmount

      _accel.set(0, 0, 0)
        .addScaledVector(_sep, p.separationWeight * adhMul)
        .addScaledVector(_ali, p.alignmentWeight * adhMul)
        .addScaledVector(_coh, p.cohesionWeight * adhMul)
        .addScaledVector(_att, p.attractionWeight * adhMul)

      let vx = state.vel[ix + 0] + _accel.x * dt
      let vy = state.vel[ix + 1] + _accel.y * dt
      let vz = state.vel[ix + 2] + _accel.z * dt

      const localMaxSpeed = Math.max(0.001, p.maxSpeed * speedMul)
      const speed = Math.hypot(vx, vy, vz)
      if (speed > localMaxSpeed) {
        const s = localMaxSpeed / speed
        vx *= s
        vy *= s
        vz *= s
      }

      const jitterAmp = p.noiseBase + p.noiseVelScale * speed
      const ph = phBase
      const jx =
        Math.sin(t * p.noiseFreq1 + state.phase[ph + 0]) +
        0.5 * Math.sin(t * p.noiseFreq2 + state.phase[ph + 1])
      const jy =
        Math.sin(t * p.noiseFreq1 + state.phase[ph + 2]) +
        0.5 * Math.sin(t * p.noiseFreq2 + state.phase[ph + 3])
      const jz =
        Math.sin(t * p.noiseFreq1 + state.phase[ph + 4]) +
        0.5 * Math.sin(t * p.noiseFreq2 + state.phase[ph + 5])

      const nxPos = px + vx * dt + jx * jitterAmp * dt
      const nyPos = py + vy * dt + jy * jitterAmp * dt
      const nzPos = pz + vz * dt + jz * jitterAmp * dt

      state.vel[ix + 0] = vx
      state.vel[ix + 1] = vy
      state.vel[ix + 2] = vz
      state.pos[ix + 0] = nxPos
      state.pos[ix + 1] = nyPos
      state.pos[ix + 2] = nzPos

      const g = groupRefs.current[i]
      if (g) {
        g.position.set(nxPos, nyPos, nzPos)
        const dirLen = Math.hypot(vx, vy, vz)
        if (dirLen > 0.01) {
          _v.set(nxPos, nyPos, nzPos)
          _lookTarget.set(nxPos + vx, nyPos + vy, nzPos + vz)
          _matrix.lookAt(_v, _lookTarget, _up)
          _targetQuat.setFromRotationMatrix(_matrix)
          const k = 1 - Math.exp(-p.rotationLerp * dt)
          g.quaternion.slerp(_targetQuat, k)
        }
        g.scale.setScalar(p.meshSize)
        g.visible = true
      }

      cx += nxPos
      cy += nyPos
      cz += nzPos
    }

    for (let i = n; i < MAX_BOIDS; i++) {
      const g = groupRefs.current[i]
      if (g) g.visible = false
    }

    if (centroidRef?.current && n > 0) {
      centroidRef.current.set(cx / n, cy / n, cz / n)
    }

    updateDebugVisuals(state.pos, n, target, p.showDebug, p.neighborRadius, p.separationRadius)
  })

  const updateDebugVisuals = (
    pos: Float32Array,
    n: number,
    target: THREE.Vector3,
    enabled: boolean,
    nbrR: number,
    sepR: number,
  ) => {
    const nbrMesh = neighborMeshRef.current
    const sepMesh = sepMeshRef.current
    const line = lineRef.current

    if (nbrMesh) {
      nbrMesh.count = enabled ? n : 0
      if (enabled) {
        for (let i = 0; i < n; i++) {
          _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
          _matrix.compose(_v, _identityQuat, _scaleVec.setScalar(nbrR))
          nbrMesh.setMatrixAt(i, _matrix)
        }
        nbrMesh.instanceMatrix.needsUpdate = true
      }
    }
    if (sepMesh) {
      sepMesh.count = enabled ? n : 0
      if (enabled) {
        for (let i = 0; i < n; i++) {
          _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
          _matrix.compose(_v, _identityQuat, _scaleVec.setScalar(sepR))
          sepMesh.setMatrixAt(i, _matrix)
        }
        sepMesh.instanceMatrix.needsUpdate = true
      }
    }
    if (line && enabled) {
      const arr = (line.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
      for (let i = 0; i < n; i++) {
        arr[i * 6 + 0] = pos[i * 3 + 0]
        arr[i * 6 + 1] = pos[i * 3 + 1]
        arr[i * 6 + 2] = pos[i * 3 + 2]
        arr[i * 6 + 3] = target.x
        arr[i * 6 + 4] = target.y
        arr[i * 6 + 5] = target.z
      }
      line.geometry.setDrawRange(0, n * 2)
      ;(line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    } else if (line) {
      line.geometry.setDrawRange(0, 0)
    }
  }

  return (
    <>
      <Suspense fallback={null}>
        {Array.from({ length: MAX_BOIDS }, (_, i) => (
          <Butterfly
            key={i}
            withAudio={i < 3}
            intensityRef={intensityRef}
            ref={(g) => {
              groupRefs.current[i] = g
            }}
          />
        ))}
      </Suspense>
      {showDebug && (
        <>
          <instancedMesh
            ref={neighborMeshRef}
            args={[undefined, undefined, MAX_BOIDS]}
            frustumCulled={false}
          >
            <sphereGeometry args={[1, 8, 5]} />
            <meshBasicMaterial color={0x00ffff} wireframe transparent opacity={0.2} />
          </instancedMesh>
          <instancedMesh
            ref={sepMeshRef}
            args={[undefined, undefined, MAX_BOIDS]}
            frustumCulled={false}
          >
            <sphereGeometry args={[1, 6, 4]} />
            <meshBasicMaterial color={0xff8800} wireframe transparent opacity={0.35} />
          </instancedMesh>
          <lineSegments ref={lineRef} frustumCulled={false}>
            <primitive object={lineGeometry} attach="geometry" />
            <lineBasicMaterial color={0xffff00} transparent opacity={0.6} />
          </lineSegments>
        </>
      )}
    </>
  )
})
