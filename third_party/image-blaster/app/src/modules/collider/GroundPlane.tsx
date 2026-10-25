import { RigidBody, CuboidCollider } from '@react-three/rapier'
import { useDebugStore } from '../../store/debug'
import { ObjectRenderMode } from '../../types/world'
import { SHADED_COLOR } from '../scene/useAssetMaterials'
import { DROP_TARGET_LAYER } from '../scene/dropTargets'

const LARGE = 200
const FLOOR_THICKNESS = 0.05

interface GroundPlaneProps {
  groundColliderEnabled?: boolean
}

export function GroundPlane({ groundColliderEnabled = true }: GroundPlaneProps) {
  const objectRenderMode = useDebugStore((s) => s.objectRenderMode)

  const isLit = objectRenderMode === ObjectRenderMode.Lit
  const isShaded = objectRenderMode === ObjectRenderMode.ShadedWireframe

  return (
    <>
      {groundColliderEnabled && !isLit && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[LARGE, LARGE]} />
            {isShaded
              ? <meshStandardMaterial color={SHADED_COLOR} roughness={0.75} metalness={0} />
              : <meshBasicMaterial color={0x000000} wireframe toneMapped={false} fog={false} />
            }
          </mesh>
          {isShaded && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} renderOrder={1}>
              <planeGeometry args={[LARGE, LARGE]} />
              <meshBasicMaterial color={0x000000} wireframe toneMapped={false} fog={false} />
            </mesh>
          )}
        </>
      )}

      {groundColliderEnabled && (
        <RigidBody type="fixed">
          <CuboidCollider args={[LARGE / 2, FLOOR_THICKNESS, LARGE / 2]} position={[0, -FLOOR_THICKNESS, 0]} />
        </RigidBody>
      )}
      {groundColliderEnabled && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          onUpdate={(mesh) => mesh.layers.set(DROP_TARGET_LAYER)}
        >
          <planeGeometry args={[LARGE, LARGE]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}

      {/* physics safety net */}
      <RigidBody type="fixed" position={[0, -10, 0]}>
        <CuboidCollider args={[LARGE / 2, 1, LARGE / 2]} />
      </RigidBody>
    </>
  )
}
