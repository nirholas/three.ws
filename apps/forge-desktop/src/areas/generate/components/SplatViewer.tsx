import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'

export interface SplatViewerHandle {
  screenshot: () => string | null
}

// ---------------------------------------------------------------------------
// X/Y/Z orientation gizmo — a tiny overlay Canvas synced to the splat camera.
// mkkellogg runs outside R3F, so the mesh viewer's drei GizmoHelper can't be
// reused; this mirrors its look (coloured axis bubbles) driven by the live
// camera quaternion.
// ---------------------------------------------------------------------------

function makeAxisLabelTexture(letter: string, bg: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(32, 32, 16, 0, 2 * Math.PI)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.font = '18px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(letter, 32, 41)
  return new THREE.CanvasTexture(canvas)
}

const GIZMO_AXES: { letter: string; color: string; pos: [number, number, number]; rot: [number, number, number] }[] = [
  { letter: 'X', color: '#f87171', pos: [1, 0, 0], rot: [0, 0, 0] },
  { letter: 'Y', color: '#4ade80', pos: [0, 1, 0], rot: [0, 0, Math.PI / 2] },
  { letter: 'Z', color: '#60a5fa', pos: [0, 0, 1], rot: [0, -Math.PI / 2, 0] },
]

type Axis = 'x' | 'y' | 'z'

function AxisBubble({
  axis,
  texture,
  onAxisClick,
}: {
  axis: (typeof GIZMO_AXES)[number]
  texture: THREE.CanvasTexture
  onAxisClick: (axis: Axis) => void
}): JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <sprite
      position={axis.pos}
      scale={hovered ? 1.2 : 1}
      onPointerDown={(e) => { e.stopPropagation(); onAxisClick(axis.letter.toLowerCase() as Axis) }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default' }}
    >
      <spriteMaterial map={texture} alphaTest={0.3} toneMapped={false} />
    </sprite>
  )
}

function GizmoContent({
  getQuaternion,
  onAxisClick,
}: {
  getQuaternion: () => THREE.Quaternion | undefined
  onAxisClick: (axis: Axis) => void
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null)
  const textures = useMemo(() => GIZMO_AXES.map((a) => makeAxisLabelTexture(a.letter, a.color)), [])
  useEffect(() => () => { textures.forEach((t) => t.dispose()) }, [textures])

  useFrame(() => {
    const q = getQuaternion()
    if (q && groupRef.current) groupRef.current.quaternion.copy(q).invert()
  })

  // Same proportions as the mesh viewer's drei GizmoHelper: bubbles group at
  // scale 40 under an orthographic camera (1 world unit ≈ 1 px).
  return (
    <group ref={groupRef} scale={40}>
      {GIZMO_AXES.map((axis) => (
        <group key={`line-${axis.letter}`} rotation={axis.rot}>
          <mesh position={[0.4, 0, 0]}>
            <boxGeometry args={[0.8, 0.05, 0.05]} />
            <meshBasicMaterial color={axis.color} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {GIZMO_AXES.map((axis, i) => (
        <AxisBubble key={axis.letter} axis={axis} texture={textures[i]} onAxisClick={onAxisClick} />
      ))}
    </group>
  )
}

function SplatGizmo({
  getQuaternion,
  onAxisClick,
}: {
  getQuaternion: () => THREE.Quaternion | undefined
  onAxisClick: (axis: Axis) => void
}): JSX.Element {
  // Orthographic camera mirrors drei's GizmoHelper so the splat gizmo matches
  // the mesh (GLB) gizmo's size and look exactly.
  return (
    <div className="absolute top-3 right-3 w-32 h-32">
      <Canvas orthographic camera={{ position: [0, 0, 200], zoom: 1 }} gl={{ alpha: true }}>
        <GizmoContent getQuaternion={getQuaternion} onAxisClick={onAxisClick} />
      </Canvas>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Frame the loaded splat like the mesh viewer: the mesh viewer recenters the
// model and uses a fixed camera, but mkkellogg sorts splats by their built
// positions, so translating the splatMesh would corrupt depth sorting. Instead
// we measure the splat's bounds (sampled splat centres) and fit the *camera*
// to them, then drop the grid under the model's feet.
// ---------------------------------------------------------------------------

function frameSplatToView(viewer: any, grid: THREE.GridHelper): void {
  const splatMesh = viewer?.splatMesh
  const camera = viewer?.camera
  if (!splatMesh || !camera) return

  const count: number = splatMesh.getSplatCount?.() ?? 0
  if (count === 0) return

  const box = new THREE.Box3()
  const c = new THREE.Vector3()
  const step = Math.max(1, Math.floor(count / 20000)) // sample for large clouds
  for (let i = 0; i < count; i += step) {
    splatMesh.getSplatCenter(i, c, true) // true → built (rendered) coordinates
    box.expandByPoint(c)
  }
  if (box.isEmpty()) return

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)

  // Pull back enough to fit the largest dimension at fov 45, with margin.
  const fov = (camera.fov ?? 45) * (Math.PI / 180)
  const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.6

  // Same 3/4 front view as the mesh viewer; −Z side shows the face after the
  // 180° Z flip applied in addSplatScene.
  const dir = new THREE.Vector3(0, 0.35, -1).normalize()
  camera.position.copy(center).add(dir.multiplyScalar(dist))
  camera.lookAt(center)

  const controls = viewer.controls
  if (controls?.target) {
    controls.target.copy(center)
    controls.update?.()
  }

  grid.position.y = box.min.y // feet on the grid, like the mesh viewer
}

// ---------------------------------------------------------------------------
// SplatViewer — self-contained Gaussian-Splatting viewer (mkkellogg, outside
// R3F). It owns its own canvas / scene / camera / controls, so nothing from the
// mesh viewer's pipeline can interfere. Fed a normalised binary .splat.
// ---------------------------------------------------------------------------

const SplatViewer = forwardRef<SplatViewerHandle, { url: string; autoRotate: boolean }>(
  function SplatViewer({ url, autoRotate }, ref): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string>('')

  // Screenshot: render() is not gated by mkkellogg's shouldRender() optimisation,
  // so a synchronous render + toDataURL in the same tick captures a full frame
  // even though the renderer has no preserveDrawingBuffer.
  useImperativeHandle(ref, () => ({
    screenshot: () => {
      const viewer = viewerRef.current
      if (!viewer?.renderer) return null
      try { viewer.render() } catch { return null }
      return viewer.renderer.domElement.toDataURL('image/png')
    },
  }), [])

  // Auto-rotate via mkkellogg's built-in OrbitControls.
  useEffect(() => {
    const controls = viewerRef.current?.controls
    if (!controls) return
    controls.autoRotate = autoRotate
    controls.autoRotateSpeed = 1.5
  }, [autoRotate, status])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    setStatus('loading')
    setMessage('')

    let disposed = false
    let viewer: any = null

    try {
      viewer = new GaussianSplats3D.Viewer({
        rootElement:            container,
        selfDrivenMode:         true,
        useBuiltInControls:     true,
        sharedMemoryForWorkers: false,        // no cross-origin isolation in Electron/Vite
        gpuAcceleratedSort:     false,        // CPU sort — most robust across GPUs/Electron
        // Frame like the mesh viewer: look at the model's centre (feet at y=0,
        // head ≈ 2), from the front. This splat faces −Z after the 180° Z flip,
        // so the camera sits on the −Z side to show the face, not the back.
        initialCameraPosition:  [0, 1.2, -3.8],
        initialCameraLookAt:    [0, 0.8, 0],
        cameraUp:               [0, 1, 0],
      })
      viewerRef.current = viewer

      // Match the mesh viewer's framing: mkkellogg defaults to fov 65, the mesh
      // Canvas uses 45 — the wider fov made the splat look smaller / distorted.
      if (viewer.camera) {
        viewer.camera.fov = 45
        viewer.camera.updateProjectionMatrix()
      }

      // Floor grid, matching the mesh viewer.
      const grid = new THREE.GridHelper(10, 20, 0x3f3f46, 0x27272a)
      viewer.threeScene.add(grid)

      viewer
        .addSplatScene(url, {
          format:          GaussianSplats3D.SceneFormat.Splat,
          showLoadingUI:   false,
          progressiveLoad: false,
          rotation:        [0, 0, 1, 0],   // 180° about Z — 3DGS is Y-down; stands it upright while keeping the front toward the camera (X-mirror is invisible on a symmetric model)
        })
        .then(() => {
          if (disposed) return
          viewer.start()
          frameSplatToView(viewer, grid)
          setStatus('ready')
        })
        .catch((err: unknown) => {
          if (disposed) return
          console.error('[SplatViewer] load failed:', err)
          setStatus('error')
          setMessage(String((err as Error)?.message ?? err))
        })
    } catch (err) {
      console.error('[SplatViewer] init failed:', err)
      setStatus('error')
      setMessage(String((err as Error)?.message ?? err))
    }

    return () => {
      disposed = true
      viewerRef.current = null
      try {
        viewer?.stop()
        viewer?.dispose()
      } catch { /* already torn down */ }
    }
  }, [url])

  const getCameraQuaternion = () => viewerRef.current?.camera?.quaternion as THREE.Quaternion | undefined

  // Snap the camera to look down an axis, like the mesh viewer's gizmo.
  const snapToAxis = (axis: Axis) => {
    const viewer = viewerRef.current
    const camera = viewer?.camera
    if (!camera) return
    const controls = viewer.controls
    const target: THREE.Vector3 = controls?.target ?? new THREE.Vector3(0, 0.8, 0)
    const dist = camera.position.distanceTo(target) || 4
    const dir = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis]
    camera.position.set(target.x + dir[0] * dist, target.y + dir[1] * dist, target.z + dir[2] * dist)
    camera.up.set(...(axis === 'y' ? [0, 0, -1] : [0, 1, 0]) as [number, number, number])
    camera.lookAt(target)
    controls?.update?.()
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      {status === 'ready' && <SplatGizmo getQuaternion={getCameraQuaternion} onAxisClick={snapToAxis} />}
      {status !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 pointer-events-none gap-2">
          {status === 'loading' ? (
            <p className="text-sm">Loading splat…</p>
          ) : (
            <>
              <p className="text-sm text-red-400">Splat failed to load</p>
              {message && <p className="text-xs text-zinc-500 max-w-md text-center px-4 break-words">{message}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
})

export default SplatViewer
