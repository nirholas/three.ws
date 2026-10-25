import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

const AXIS_LENGTH = 0.2

interface ObjectHoverGuidesProps {
  size: THREE.Vector3 | [number, number, number]
}

function sizeTuple(size: THREE.Vector3 | [number, number, number]): [number, number, number] {
  return Array.isArray(size) ? size : [size.x, size.y, size.z]
}

function useLineGeometry(positions: number[], colors?: number[]) {
  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    if (colors) next.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return next
  }, [colors, positions])

  useEffect(() => () => geometry.dispose(), [geometry])

  return geometry
}

export function ObjectHoverGuides({ size }: ObjectHoverGuidesProps) {
  const [width, height, depth] = sizeTuple(size)
  const safeWidth = Math.max(width, 0.01)
  const safeHeight = Math.max(height, 0.01)
  const safeDepth = Math.max(depth, 0.01)
  const halfWidth = safeWidth / 2
  const halfHeight = safeHeight / 2
  const halfDepth = safeDepth / 2

  const axisGeometry = useLineGeometry([
    0, 0, 0, AXIS_LENGTH, 0, 0,
    0, 0, 0, 0, AXIS_LENGTH, 0,
    0, 0, 0, 0, 0, AXIS_LENGTH,
  ], [
    1, 0.15, 0.15, 1, 0.15, 0.15,
    0.2, 1, 0.2, 0.2, 1, 0.2,
    0.25, 0.5, 1, 0.25, 0.5, 1,
  ])

  const boxGeometry = useLineGeometry([
    -halfWidth, -halfHeight, -halfDepth, halfWidth, -halfHeight, -halfDepth,
    halfWidth, -halfHeight, -halfDepth, halfWidth, -halfHeight, halfDepth,
    halfWidth, -halfHeight, halfDepth, -halfWidth, -halfHeight, halfDepth,
    -halfWidth, -halfHeight, halfDepth, -halfWidth, -halfHeight, -halfDepth,

    -halfWidth, halfHeight, -halfDepth, halfWidth, halfHeight, -halfDepth,
    halfWidth, halfHeight, -halfDepth, halfWidth, halfHeight, halfDepth,
    halfWidth, halfHeight, halfDepth, -halfWidth, halfHeight, halfDepth,
    -halfWidth, halfHeight, halfDepth, -halfWidth, halfHeight, -halfDepth,

    -halfWidth, -halfHeight, -halfDepth, -halfWidth, halfHeight, -halfDepth,
    halfWidth, -halfHeight, -halfDepth, halfWidth, halfHeight, -halfDepth,
    halfWidth, -halfHeight, halfDepth, halfWidth, halfHeight, halfDepth,
    -halfWidth, -halfHeight, halfDepth, -halfWidth, halfHeight, halfDepth,
  ])

  return (
    <group>
      <lineSegments geometry={axisGeometry}>
        <lineBasicMaterial vertexColors depthTest depthWrite toneMapped={false} />
      </lineSegments>
      <lineSegments geometry={boxGeometry} position={[0, halfHeight, 0]}>
        <lineBasicMaterial color={0xffffff} depthTest depthWrite toneMapped={false} />
      </lineSegments>
    </group>
  )
}
