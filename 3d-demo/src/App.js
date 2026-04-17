// https://discourse.threejs.org/t/meshes-push-away-from-mouse-hover/68397

import * as THREE from 'three'
import { useRef, useMemo } from 'react'
import { Canvas, extend, useFrame } from '@react-three/fiber'
import { OrbitControls, Instances, Instance } from '@react-three/drei'
import { EffectComposer, N8AO, Bloom } from '@react-three/postprocessing'
import { RoundedBoxGeometry } from 'three-stdlib'
import { easing } from 'maath'

extend({ RoundedBoxGeometry })

export default function App() {
  return (
    <Canvas shadows gl={{ antialias: false }} camera={{ position: [15, 15, 15], fov: 25 }}>
      <color attach="background" args={['#151520']} />
      <ambientLight intensity={Math.PI / 2} />
      <spotLight position={[-10, 20, 20]} angle={0.15} penumbra={1} decay={0} intensity={2} castShadow />
      <Cubes gap={0.1} stride={4} displacement={3} intensity={1} />
      <EffectComposer>
        <N8AO aoRadius={1} intensity={1} />
        <Bloom mipmapBlur luminanceThreshold={1} levels={7} intensity={1} />
      </EffectComposer>
      <OrbitControls />
    </Canvas>
  )
}

function Cubes({ gap = 0.1, stride = 4, displacement = 3, intensity = 1 }) {
  const cursor = new THREE.Vector3()
  const oPos = new THREE.Vector3()
  const vec = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const ref = useRef()

  const positions = useMemo(() => {
    const temp = []
    const center = stride / 2 - stride * gap + gap
    for (let x = 0; x < stride; x++)
      for (let y = 0; y < stride; y++)
        for (let z = 0; z < stride; z++) temp.push([x + x * gap - center, y + y * gap - center, z + z * gap - center])
    return temp
  }, [stride, gap])

  useFrame(({ pointer, camera, clock }, delta) => {
    cursor.set(pointer.x, pointer.y, 0.5).unproject(camera)
    dir.copy(cursor).sub(camera.position).normalize()
    cursor.add(dir.multiplyScalar(camera.position.length()))
    let count = 0
    for (let child of ref.current.children) {
      oPos.set(...positions[count++])
      dir.copy(oPos).sub(cursor).normalize()
      const dist = oPos.distanceTo(cursor)
      const distInv = displacement - dist
      const col = Math.max(0.5, distInv) / 1.5
      const mov = 1 + Math.sin(clock.elapsedTime * 2 + 1000 * count)
      easing.dampC(child.color, dist > displacement * 1.1 ? 'white' : [col / 2, col * 2, col * 4], 0.1, delta)
      easing.damp3(
        child.position,
        dist > displacement ? oPos : vec.copy(oPos).add(dir.multiplyScalar(distInv * intensity + mov / 4)),
        0.2,
        delta
      )
    }
  })

  return (
    <Instances key={stride} limit={stride * stride * stride} castShadow receiveShadow frames={Infinity} ref={ref}>
      <roundedBoxGeometry args={[1, 1, 1, 2, 0.15]} />
      <meshLambertMaterial />
      {Array.from({ length: stride * stride * stride }, (v, n) => (
        <Instance key={n} position={positions[n]} />
      ))}
    </Instances>
  )
}
