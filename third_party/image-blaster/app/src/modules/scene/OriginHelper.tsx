import { useDebugStore } from '../../store/debug'

export function OriginHelper() {
  const showOrigin = useDebugStore((s) => s.showOrigin)
  if (!showOrigin) return null

  return (
    <group>
      {/* flat plane at Y=0 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshBasicMaterial color={0x00ff88} wireframe />
      </mesh>
      {/* wire sphere at origin */}
      <mesh>
        <sphereGeometry args={[0.5, 16, 12]} />
        <meshBasicMaterial color={0xff4400} wireframe />
      </mesh>
    </group>
  )
}
