import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import { TransformControls } from '@react-three/drei'
import { ThreeEvent, useThree } from '@react-three/fiber'
import { useLocation } from 'wouter'
import {
  ArrowLeft,
  ArrowUUpLeft,
  ArrowUUpRight,
  ArrowsOutCardinal,
  Copy,
  CornersOut,
  FloppyDisk,
  FolderOpen,
  Trash,
  ArrowClockwise,
  ArrowDown,
  Cube,
  GlobeSimple,
  Plus,
} from '@phosphor-icons/react'
import * as THREE from 'three'
import { AppButton } from '../../components/AppButton'
import { ChromePanel, ChromeThumbnail, chrome } from '../../components/AppChrome'
import { ObjectRenderMode, type WorldObjectAsset, type WorldObjectPhysics, type WorldObjectPlacement, type WorldSceneProject, type WorldSceneSun } from '../../types/world'
import { OBJECT_SCALE } from './SceneObject'
import { getInitialPlacements } from './placements'
import { DROP_TARGET_LAYER } from './dropTargets'
import { useSceneObjectVisual } from './useSceneObjectVisual'
import { ObjectHoverGuides } from './ObjectHoverGuides'
import { isEditableTarget } from '../../utils/dom'
import {
  DEFAULT_SHADOW_CATCHER_COLOR,
  DEFAULT_SHADOW_CATCHER_OPACITY,
  shadowCatcherColor as normalizeShadowCatcherColor,
  shadowCatcherOpacity as normalizeShadowCatcherOpacity,
} from './shadows'
import { twMerge } from 'tailwind-merge'

export type TransformMode = 'translate' | 'rotate' | 'scale'
type TransformField = 'position' | 'rotation' | 'scale'
type TransformAxis = 0 | 1 | 2

interface EditorStateArgs {
  slug: string
  objects: WorldObjectAsset[]
  allObjectAssets: WorldObjectAsset[]
  sceneProject?: WorldSceneProject
  baseMetricScaleFactor: number
  baseGroundPlaneOffset: number
  sceneProjectReady: boolean
  editing: boolean
  hoveredObjectAssetId?: string | null
  hoveredObjectInstanceId?: string | null
  onObjectHover?: (asset: WorldObjectAsset, hovering: boolean, instanceId?: string) => void
  onProjectSaved?: (project: WorldSceneProject) => void
}

interface EditableObjectProps {
  asset: WorldObjectAsset
  placement: WorldObjectPlacement
  selected: boolean
  externallyHovered?: boolean
  renderMode: ObjectRenderMode
  onSelect: (event: ThreeEvent<MouseEvent>, instanceId: string) => void
  onHover: (event: ThreeEvent<PointerEvent>, instanceId: string) => void
  onHoverEnd: (event: ThreeEvent<PointerEvent>, instanceId: string) => void
  setRef?: (group: THREE.Group | null) => void
}

interface PlacementEditorSceneProps {
  controller: PlacementEditorController
  renderMode: ObjectRenderMode
}

interface PlacementEditorOverlayProps {
  controller: PlacementEditorController
}

export interface PlacementEditorController {
  slug: string
  objects: WorldObjectAsset[]
  allObjectAssets: WorldObjectAsset[]
  visibleAssetLibrary: WorldObjectAsset[]
  assetFilter: 'world' | 'all'
  setAssetFilter: (filter: 'world' | 'all') => void
  assetsById: Map<string, WorldObjectAsset>
  instances: WorldObjectPlacement[]
  selectedId: string | null
  hoveredObjectAssetId?: string | null
  hoveredObjectInstanceId?: string | null
  selectedInstance?: WorldObjectPlacement
  mode: TransformMode
  setMode: (mode: TransformMode) => void
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  setSelectedId: Dispatch<SetStateAction<string | null>>
  selectInstance: (event: ThreeEvent<MouseEvent>, instanceId: string) => void
  selectFromOverlay: (instanceId: string) => void
  hoverAsset: (asset: WorldObjectAsset, hovering: boolean, instanceId?: string) => void
  commitInstances: (next: WorldObjectPlacement[]) => void
  duplicateSelected: () => void
  duplicateInstance: (instanceId: string) => void
  deleteSelected: () => void
  deleteInstance: (instanceId: string) => void
  addAsset: (asset: WorldObjectAsset) => void
  dropSelectedToFloor: () => void
  setDropSelectedToFloorHandler: (handler: (() => void) | null) => void
  updateSelectedTransform: (field: TransformField, axis: TransformAxis, value: number) => void
  updateSelectedPhysics: (physics: WorldObjectPhysics) => void
  sun: WorldSceneSun
  updateSunIntensity: (intensity: number) => void
  updateEnvironmentIntensity: (intensity: number) => void
  updateSunRotation: (axis: TransformAxis, value: number) => void
  metricScaleFactor: number
  resetMetricScaleFactor: () => void
  updateMetricScaleFactor: (metricScaleFactor: number) => void
  groundPlaneOffset: number
  resetGroundPlaneOffset: () => void
  updateGroundPlaneOffset: (groundPlaneOffset: number) => void
  groundPlaneColliderEnabled: boolean
  updateGroundPlaneColliderEnabled: (enabled: boolean) => void
  shadowCatcherOpacity: number
  resetShadowCatcherOpacity: () => void
  updateShadowCatcherOpacity: (shadowCatcherOpacity: number) => void
  shadowCatcherColor: string
  resetShadowCatcherColor: () => void
  updateShadowCatcherColor: (shadowCatcherColor: string) => void
  undo: () => void
  redo: () => void
  resetEdits: () => void
  openWorldFolder: () => void
  saveProject: () => Promise<boolean>
  setFlushSelectedTransformHandler: (handler: (() => WorldObjectPlacement[] | null) | null) => void
}

interface EditorBaseline {
  slug: string
  instances: WorldObjectPlacement[]
  sun: WorldSceneSun
  metricScaleFactor: number
  groundPlaneOffset: number
  groundPlaneColliderEnabled: boolean
  shadowCatcherOpacity: number
  shadowCatcherColor: string
  signature: string
}

const HISTORY_LIMIT = 80
const PASTE_OFFSET: [number, number, number] = [0.25, 0, 0.25]
const ROTATION_SNAP_DEGREES = 5
const VALUE_EPSILON = 0.0005
const EDITABLE_OBJECT_INSTANCE_ID_KEY = 'editableObjectInstanceId'
const projectVersion = 1
const DEFAULT_SCENE_SUN: WorldSceneSun = { intensity: 1, rotation: [0, 0, 0], environmentIntensity: 2 }
const TRANSFORM_FIELDS: Array<{ field: TransformField; label: string; step: number }> = [
  { field: 'position', label: 'Pos', step: 0.01 },
  { field: 'rotation', label: 'Rot', step: ROTATION_SNAP_DEGREES },
  { field: 'scale', label: 'Scale', step: 0.01 },
]
const TRANSFORM_AXES: Array<{ axis: TransformAxis; label: string }> = [
  { axis: 0, label: 'X' },
  { axis: 1, label: 'Y' },
  { axis: 2, label: 'Z' },
]
const SCRUB_PIXELS_PER_STEP = 8
const _editableObjectCenter = new THREE.Vector3()
const _projectedEditableObjectCenter = new THREE.Vector3()

function clonePlacements(instances: WorldObjectPlacement[]): WorldObjectPlacement[] {
  return instances.map((instance) => ({
    ...instance,
    physics: instance.physics ?? 'rigidbody',
    position: [...instance.position],
    rotation: [...instance.rotation],
    scale: [...instance.scale],
  }))
}

function cloneSun(sun: WorldSceneSun = DEFAULT_SCENE_SUN): WorldSceneSun {
  return {
    intensity: sun.intensity,
    rotation: [...sun.rotation],
    environmentIntensity: sun.environmentIntensity ?? DEFAULT_SCENE_SUN.environmentIntensity,
  }
}

function signature(value: unknown) {
  return JSON.stringify(value)
}

function editorStateSignature(
  instances: WorldObjectPlacement[],
  sun: WorldSceneSun,
  metricScaleFactor: number,
  groundPlaneOffset: number,
  groundPlaneColliderEnabled: boolean,
  shadowCatcherOpacity: number,
  shadowCatcherColor: string,
) {
  return signature({
    instances,
    sun,
    metricScaleFactor,
    groundPlaneOffset,
    groundPlaneColliderEnabled,
    shadowCatcherOpacity,
    shadowCatcherColor,
  })
}

function scaledGroundPlaneOffset(baseGroundPlaneOffset: number, metricScaleFactor: number, baseMetricScaleFactor: number) {
  const divisor = baseMetricScaleFactor || 1
  return baseGroundPlaneOffset * (metricScaleFactor / divisor)
}

function makeEditorBaseline({
  slug,
  objects,
  sceneProject,
  baseMetricScaleFactor,
  baseGroundPlaneOffset,
}: {
  slug: string
  objects: WorldObjectAsset[]
  sceneProject?: WorldSceneProject
  baseMetricScaleFactor: number
  baseGroundPlaneOffset: number
}): EditorBaseline {
  const metricScaleFactor = sceneProject?.metricScaleFactor ?? baseMetricScaleFactor
  const groundPlaneOffset = sceneProject?.groundPlaneOffset ??
    scaledGroundPlaneOffset(baseGroundPlaneOffset, metricScaleFactor, baseMetricScaleFactor)
  const groundPlaneColliderEnabled = sceneProject?.groundPlaneColliderEnabled ?? false
  const shadowCatcherOpacity = normalizeShadowCatcherOpacity(sceneProject?.shadowCatcherOpacity)
  const shadowCatcherColor = normalizeShadowCatcherColor(sceneProject?.shadowCatcherColor)
  const instances = clonePlacements(getInitialPlacements(objects, sceneProject?.instances))
  const sun = cloneSun(sceneProject?.sun)

  return {
    slug,
    instances,
    sun,
    metricScaleFactor,
    groundPlaneOffset,
    groundPlaneColliderEnabled,
    shadowCatcherOpacity,
    shadowCatcherColor,
    signature: editorStateSignature(
      instances,
      sun,
      metricScaleFactor,
      groundPlaneOffset,
      groundPlaneColliderEnabled,
      shadowCatcherOpacity,
      shadowCatcherColor,
    ),
  }
}

function isDraftDirty(
  baseline: EditorBaseline,
  instances: WorldObjectPlacement[],
  sun: WorldSceneSun,
  metricScaleFactor: number,
  groundPlaneOffset: number,
  groundPlaneColliderEnabled: boolean,
  shadowCatcherOpacity: number,
  shadowCatcherColor: string,
) {
  return editorStateSignature(
    instances,
    sun,
    metricScaleFactor,
    groundPlaneOffset,
    groundPlaneColliderEnabled,
    shadowCatcherOpacity,
    shadowCatcherColor,
  ) !== baseline.signature
}

function asTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z]
}

function eulerTuple(quaternion: THREE.Quaternion): [number, number, number] {
  const euler = new THREE.Euler().setFromQuaternion(quaternion)
  return [euler.x, euler.y, euler.z]
}

function makeInstanceId(objectId: string) {
  return `${objectId.replace(/[^a-z0-9_-]/gi, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function assetKey(asset: WorldObjectAsset) {
  return asset.assetId || `${asset.sourceWorldSlug}/${asset.id}`
}

function addAssetAliases(map: Map<string, WorldObjectAsset>, asset: WorldObjectAsset) {
  map.set(asset.id, asset)
  map.set(assetKey(asset), asset)
  map.set(asset.baseObjectId, asset)
  map.set(`${asset.sourceWorldSlug}/${asset.baseObjectId}`, asset)
}

function placementAssetKey(placement: WorldObjectPlacement) {
  return placement.assetId ?? placement.objectId
}

function editableObjectInstanceIdFromIntersectionObject(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object
  while (current) {
    const instanceId = current.userData[EDITABLE_OBJECT_INSTANCE_ID_KEY]
    if (typeof instanceId === 'string') return instanceId
    current = current.parent
  }
  return null
}

function nearestEditableObjectInstanceId(
  event: ThreeEvent<MouseEvent | PointerEvent>,
  fallbackInstanceId: string,
  camera: THREE.Camera,
) {
  const seenInstanceIds = new Set<string>()
  let best: { instanceId: string; centerDistanceSq: number; hitDistance: number } | null = null

  for (const intersection of event.intersections) {
    const instanceId = editableObjectInstanceIdFromIntersectionObject(intersection.object)
    if (!instanceId || seenInstanceIds.has(instanceId)) continue
    seenInstanceIds.add(instanceId)

    intersection.object.getWorldPosition(_editableObjectCenter)
    _projectedEditableObjectCenter.copy(_editableObjectCenter).project(camera)
    const centerDistanceSq =
      (_projectedEditableObjectCenter.x - event.pointer.x) ** 2 +
      (_projectedEditableObjectCenter.y - event.pointer.y) ** 2
    const hitDistance = Number.isFinite(intersection.distance) ? intersection.distance : Number.POSITIVE_INFINITY
    if (
      !best ||
      centerDistanceSq < best.centerDistanceSq ||
      (centerDistanceSq === best.centerDistanceSq && hitDistance < best.hitDistance)
    ) {
      best = { instanceId, centerDistanceSq, hitDistance }
    }
  }

  return best?.instanceId ?? fallbackInstanceId
}

function EditableObject({
  asset,
  placement,
  selected,
  externallyHovered = false,
  renderMode,
  onSelect,
  onHover,
  onHoverEnd,
  setRef,
}: EditableObjectProps) {
  const activeHovered = externallyHovered
  const { scene, wireframeOverlayScene, offset, size } = useSceneObjectVisual({
    asset,
    renderMode,
  })
  const hitboxUserData = useMemo(() => ({
    [EDITABLE_OBJECT_INSTANCE_ID_KEY]: placement.instanceId,
  }), [placement.instanceId])
  const hoverGuideSize = useMemo(
    () => new THREE.Vector3(
      Math.max(size.x * OBJECT_SCALE, 0.01),
      Math.max(size.y * OBJECT_SCALE, 0.01),
      Math.max(size.z * OBJECT_SCALE, 0.01),
    ),
    [size],
  )

  return (
    <group
      ref={setRef}
      position={placement.position}
      rotation={placement.rotation}
      scale={placement.scale}
    >
      <group scale={OBJECT_SCALE}>
        <primitive object={scene} position={offset} dispose={null} />
        {renderMode === ObjectRenderMode.ShadedWireframe && (
          <primitive object={wireframeOverlayScene} position={offset} dispose={null} />
        )}
      </group>
      {(activeHovered || selected) && <ObjectHoverGuides size={hoverGuideSize} />}
      <mesh
        position={[0, Math.max(size.y * OBJECT_SCALE, 0.01) / 2, 0]}
        userData={hitboxUserData}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHover(event, placement.instanceId)
        }}
        onPointerMove={(event) => {
          event.stopPropagation()
          onHover(event, placement.instanceId)
        }}
        onPointerOut={(event) => {
          event.stopPropagation()
          onHoverEnd(event, placement.instanceId)
        }}
        onClick={(event) => onSelect(event, placement.instanceId)}
      >
        <boxGeometry args={[
          Math.max(size.x * OBJECT_SCALE, 0.05),
          Math.max(size.y * OBJECT_SCALE, 0.05),
          Math.max(size.z * OBJECT_SCALE, 0.05),
        ]} />
        <meshBasicMaterial
          color={0xffffff}
          wireframe
          transparent
          opacity={0}
          depthTest
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

function formatTransformValue(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : '0'
}

function transformInputValue(field: TransformField, value: number) {
  const displayValue = field === 'rotation' ? THREE.MathUtils.radToDeg(value) : value
  return formatTransformValue(displayValue)
}

function transformPlacementValue(field: TransformField, value: number) {
  return field === 'rotation' ? THREE.MathUtils.degToRad(value) : value
}

function snapTransformInputValue(field: TransformField, value: number) {
  if (field !== 'rotation') return value
  return Math.round(value / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES
}

function parseDraftNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '-' || trimmed === '+' || trimmed === '.' || trimmed === '-.' || trimmed === '+.') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function useHorizontalNumberScrub({
  value,
  step,
  onDraft,
  onCommit,
  format = formatTransformValue,
}: {
  value: number
  step: number
  onDraft: (value: string) => void
  onCommit: (value: number) => void
  format?: (value: number) => string
}) {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startValue: number
    moved: boolean
  } | null>(null)

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.button !== 0) return
    const parsed = parseDraftNumber(event.currentTarget.value)
    event.currentTarget.style.cursor = 'ew-resize'
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: parsed ?? value,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [value])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const deltaX = event.clientX - drag.startX
    if (Math.abs(deltaX) < 2) return
    drag.moved = true

    const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1
    const next = drag.startValue + (deltaX / SCRUB_PIXELS_PER_STEP) * step * multiplier
    onDraft(format(next))
    onCommit(next)
  }, [format, onCommit, onDraft, step])

  const finish = useCallback((event: ReactPointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.currentTarget.style.cursor = ''
    if (drag.moved) event.currentTarget.blur()
    dragRef.current = null
  }, [])

  return {
    isScrubbingRef: dragRef,
    scrubHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  }
}

function TransformValueInput({
  field,
  axis,
  step,
  value,
  onChange,
}: {
  field: TransformField
  axis: TransformAxis
  step: number
  value: number
  onChange: (field: TransformField, axis: TransformAxis, value: number) => void
}) {
  const displayNumber = field === 'rotation' ? THREE.MathUtils.radToDeg(value) : value
  const displayValue = transformInputValue(field, value)
  const [draft, setDraft] = useState(displayValue)
  const [focused, setFocused] = useState(false)
  const { scrubHandlers } = useHorizontalNumberScrub({
    value: displayNumber,
    step,
    onDraft: setDraft,
    onCommit: (next) => onChange(field, axis, transformPlacementValue(field, next)),
  })

  useEffect(() => {
    if (!focused) setDraft(displayValue)
  }, [displayValue, focused])

  return (
    <input
      type="text"
      inputMode="decimal"
      step={step}
      value={draft}
      onFocus={() => setFocused(true)}
      {...scrubHandlers}
      onChange={(event) => {
        const next = event.currentTarget.value
        setDraft(next)
        const parsed = parseDraftNumber(next)
        if (parsed !== undefined) onChange(field, axis, transformPlacementValue(field, parsed))
      }}
      onBlur={() => {
        setFocused(false)
        const parsed = parseDraftNumber(draft)
        if (parsed === undefined) {
          setDraft(displayValue)
          return
        }
        const snapped = snapTransformInputValue(field, parsed)
        setDraft(formatTransformValue(snapped))
        onChange(field, axis, transformPlacementValue(field, snapped))
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        event.currentTarget.blur()
      }}
      className="h-7 w-full cursor-ew-resize rounded border border-white/10 bg-black/40 px-1.5 text-right text-xs text-white/85"
    />
  )
}

function NumberValueInput({
  value,
  step,
  displayValue = value,
  onChange,
  toStoredValue = (next) => next,
  className = '',
}: {
  value: number
  step: number
  displayValue?: number
  onChange: (value: number) => void
  toStoredValue?: (value: number) => number
  className?: string
}) {
  const formattedValue = formatTransformValue(displayValue)
  const [draft, setDraft] = useState(formattedValue)
  const [focused, setFocused] = useState(false)
  const { scrubHandlers } = useHorizontalNumberScrub({
    value: displayValue,
    step,
    onDraft: setDraft,
    onCommit: (next) => onChange(toStoredValue(next)),
  })

  useEffect(() => {
    if (!focused) setDraft(formattedValue)
  }, [focused, formattedValue])

  return (
    <input
      type="text"
      inputMode="decimal"
      step={step}
      value={draft}
      onFocus={() => setFocused(true)}
      {...scrubHandlers}
      onChange={(event) => {
        const next = event.currentTarget.value
        setDraft(next)
        const parsed = parseDraftNumber(next)
        if (parsed !== undefined) onChange(toStoredValue(parsed))
      }}
      onBlur={() => {
        setFocused(false)
        const parsed = parseDraftNumber(draft)
        if (parsed === undefined) {
          setDraft(formattedValue)
          return
        }
        setDraft(formatTransformValue(parsed))
        onChange(toStoredValue(parsed))
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        event.currentTarget.blur()
      }}
      className={`h-7 w-full cursor-ew-resize rounded border border-white/10 bg-black/40 px-1.5 text-right text-xs text-white/85 ${className}`}
    />
  )
}

function blurEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement) || !isEditableTarget(target)) return false
  target.blur()
  return true
}

export function usePlacementEditor({
  slug,
  objects,
  allObjectAssets,
  sceneProject,
  baseMetricScaleFactor,
  baseGroundPlaneOffset,
  sceneProjectReady,
  editing,
  hoveredObjectAssetId,
  hoveredObjectInstanceId,
  onObjectHover,
  onProjectSaved,
}: EditorStateArgs): PlacementEditorController {
  const incomingBaseline = useMemo(
    () => makeEditorBaseline({ slug, objects, sceneProject, baseMetricScaleFactor, baseGroundPlaneOffset }),
    [baseGroundPlaneOffset, baseMetricScaleFactor, objects, sceneProject, slug],
  )
  const [assetFilter, setAssetFilter] = useState<'world' | 'all'>('world')
  const visibleAssetLibrary = assetFilter === 'world'
    ? allObjectAssets.filter((asset) => asset.sourceWorldSlug === slug)
    : allObjectAssets
  const assetsById = useMemo(() => {
    const map = new Map<string, WorldObjectAsset>()
    for (const asset of allObjectAssets) addAssetAliases(map, asset)
    for (const asset of objects) addAssetAliases(map, asset)
    return map
  }, [allObjectAssets, objects])
  const [baseline, setBaseline] = useState(() => incomingBaseline)
  const [instances, setInstances] = useState(() => clonePlacements(incomingBaseline.instances))
  const [sun, setSun] = useState(() => cloneSun(incomingBaseline.sun))
  const [metricScaleFactor, setMetricScaleFactor] = useState(incomingBaseline.metricScaleFactor)
  const [groundPlaneOffset, setGroundPlaneOffset] = useState(incomingBaseline.groundPlaneOffset)
  const [groundPlaneColliderEnabled, setGroundPlaneColliderEnabled] = useState(incomingBaseline.groundPlaneColliderEnabled)
  const [shadowCatcherOpacity, setShadowCatcherOpacity] = useState(incomingBaseline.shadowCatcherOpacity)
  const [shadowCatcherColor, setShadowCatcherColor] = useState(incomingBaseline.shadowCatcherColor)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<TransformMode>('translate')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const clipboardRef = useRef<WorldObjectPlacement[]>([])
  const historyRef = useRef<{ past: WorldObjectPlacement[][]; future: WorldObjectPlacement[][] }>({ past: [], future: [] })
  const baselineRef = useRef(baseline)
  const selectedIdRef = useRef(selectedId)
  const instancesRef = useRef(instances)
  const sunRef = useRef(sun)
  const metricScaleFactorRef = useRef(metricScaleFactor)
  const groundPlaneOffsetRef = useRef(groundPlaneOffset)
  const groundPlaneColliderEnabledRef = useRef(groundPlaneColliderEnabled)
  const shadowCatcherOpacityRef = useRef(shadowCatcherOpacity)
  const shadowCatcherColorRef = useRef(shadowCatcherColor)
  const dropSelectedToFloorHandlerRef = useRef<(() => void) | null>(null)
  const flushSelectedTransformHandlerRef = useRef<(() => WorldObjectPlacement[] | null) | null>(null)

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.instanceId === selectedId),
    [instances, selectedId],
  )
  const dirty = isDraftDirty(
    baseline,
    instances,
    sun,
    metricScaleFactor,
    groundPlaneOffset,
    groundPlaneColliderEnabled,
    shadowCatcherOpacity,
    shadowCatcherColor,
  )
  const canUndo = historyRef.current.past.length > 0
  const canRedo = historyRef.current.future.length > 0

  baselineRef.current = baseline
  instancesRef.current = instances
  selectedIdRef.current = selectedId
  sunRef.current = sun
  metricScaleFactorRef.current = metricScaleFactor
  groundPlaneOffsetRef.current = groundPlaneOffset
  groundPlaneColliderEnabledRef.current = groundPlaneColliderEnabled
  shadowCatcherOpacityRef.current = shadowCatcherOpacity
  shadowCatcherColorRef.current = shadowCatcherColor

  const pushHistory = useCallback((snapshot: WorldObjectPlacement[]) => {
    historyRef.current.past = [...historyRef.current.past, clonePlacements(snapshot)].slice(-HISTORY_LIMIT)
    historyRef.current.future = []
  }, [])

  const updateInstances = useCallback((updater: (current: WorldObjectPlacement[]) => WorldObjectPlacement[]) => {
    setInstances((current) => {
      const next = updater(clonePlacements(current))
      if (signature(next) === signature(current)) return current
      pushHistory(current)
      setSaveStatus('idle')
      return next
    })
  }, [pushHistory])

  useEffect(() => {
    const currentBaseline = baselineRef.current
    const sameSlug = currentBaseline.slug === incomingBaseline.slug
    if (sameSlug && incomingBaseline.signature === currentBaseline.signature) return
    if (
      sameSlug &&
      isDraftDirty(
        currentBaseline,
        instancesRef.current,
        sunRef.current,
        metricScaleFactorRef.current,
        groundPlaneOffsetRef.current,
        groundPlaneColliderEnabledRef.current,
        shadowCatcherOpacityRef.current,
        shadowCatcherColorRef.current,
      )
    ) {
      return
    }

    setBaseline(incomingBaseline)
    setInstances(clonePlacements(incomingBaseline.instances))
    setSun(cloneSun(incomingBaseline.sun))
    setMetricScaleFactor(incomingBaseline.metricScaleFactor)
    setGroundPlaneOffset(incomingBaseline.groundPlaneOffset)
    setGroundPlaneColliderEnabled(incomingBaseline.groundPlaneColliderEnabled)
    setShadowCatcherOpacity(incomingBaseline.shadowCatcherOpacity)
    setShadowCatcherColor(incomingBaseline.shadowCatcherColor)
    setSelectedId(null)
    historyRef.current = { past: [], future: [] }
    setSaveStatus('idle')
  }, [incomingBaseline])

  const commitInstances = useCallback((next: WorldObjectPlacement[]) => {
    if (signature(next) === signature(instancesRef.current)) return
    pushHistory(instancesRef.current)
    setInstances(clonePlacements(next))
    setSaveStatus('idle')
  }, [pushHistory])

  const currentInstances = useCallback(() => (
    flushSelectedTransformHandlerRef.current?.() ?? instancesRef.current
  ), [])

  const selectInstance = useCallback((event: ThreeEvent<MouseEvent>, instanceId: string) => {
    event.stopPropagation()
    setSelectedId(instanceId)
  }, [])

  const selectFromOverlay = useCallback((instanceId: string) => {
    setSelectedId(instanceId)
  }, [])

  const hoverAsset = useCallback((asset: WorldObjectAsset, hovering: boolean, instanceId?: string) => {
    onObjectHover?.(asset, hovering, instanceId)
  }, [onObjectHover])

  const copySelected = useCallback(() => {
    const selected = selectedIdRef.current
    const instance = currentInstances().find((item) => item.instanceId === selected)
    clipboardRef.current = instance ? [{ ...instance }] : []
  }, [currentInstances])

  const pasteInstances = useCallback(() => {
    const copied = clipboardRef.current
    if (!copied.length) return
    const pasted = copied.map((instance) => ({
      ...instance,
      instanceId: makeInstanceId(instance.assetId ?? instance.objectId),
      position: [
        instance.position[0] + PASTE_OFFSET[0],
        instance.position[1] + PASTE_OFFSET[1],
        instance.position[2] + PASTE_OFFSET[2],
      ] as [number, number, number],
    }))
    commitInstances([...currentInstances(), ...pasted])
    setSelectedId(pasted[pasted.length - 1]?.instanceId ?? null)
  }, [commitInstances, currentInstances])

  const duplicateSelected = useCallback(() => {
    copySelected()
    pasteInstances()
  }, [copySelected, pasteInstances])

  const duplicateInstance = useCallback((instanceId: string) => {
    const instances = currentInstances()
    const instance = instances.find((item) => item.instanceId === instanceId)
    if (!instance) return
    const duplicate = {
      ...instance,
      instanceId: makeInstanceId(instance.assetId ?? instance.objectId),
      position: [
        instance.position[0] + PASTE_OFFSET[0],
        instance.position[1] + PASTE_OFFSET[1],
        instance.position[2] + PASTE_OFFSET[2],
      ] as [number, number, number],
    }
    commitInstances([...instances, duplicate])
    setSelectedId(duplicate.instanceId)
  }, [commitInstances, currentInstances])

  const deleteSelected = useCallback(() => {
    const selected = selectedIdRef.current
    if (!selected) return
    updateInstances((current) => current.filter((instance) => instance.instanceId !== selected))
    setSelectedId(null)
  }, [updateInstances])

  const deleteInstance = useCallback((instanceId: string) => {
    updateInstances((current) => current.filter((instance) => instance.instanceId !== instanceId))
    setSelectedId((current) => (current === instanceId ? null : current))
  }, [updateInstances])

  const addAsset = useCallback((asset: WorldObjectAsset) => {
    const instance: WorldObjectPlacement = {
      instanceId: makeInstanceId(assetKey(asset)),
      objectId: asset.id,
      assetId: assetKey(asset),
      physics: 'rigidbody',
      position: [0, 0, 0.5],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }
    updateInstances((current) => [...current, instance])
    setSelectedId(instance.instanceId)
  }, [updateInstances])

  const dropSelectedToFloor = useCallback(() => {
    if (!selectedIdRef.current) return
    dropSelectedToFloorHandlerRef.current?.()
  }, [])

  const setDropSelectedToFloorHandler = useCallback((handler: (() => void) | null) => {
    dropSelectedToFloorHandlerRef.current = handler
  }, [])

  const setFlushSelectedTransformHandler = useCallback((handler: (() => WorldObjectPlacement[] | null) | null) => {
    flushSelectedTransformHandlerRef.current = handler
  }, [])

  const updateSelectedTransform = useCallback((field: TransformField, axis: TransformAxis, value: number) => {
    if (!Number.isFinite(value)) return
    const selected = selectedIdRef.current
    if (!selected) return

    updateInstances((current) => current.map((instance) => {
      if (instance.instanceId !== selected) return instance
      const nextValue = [...instance[field]] as [number, number, number]
      nextValue[axis] = value
      return { ...instance, [field]: nextValue }
    }))
  }, [updateInstances])

  const updateSelectedPhysics = useCallback((physics: WorldObjectPhysics) => {
    const selected = selectedIdRef.current
    if (!selected) return

    updateInstances((current) => current.map((instance) => (
      instance.instanceId === selected ? { ...instance, physics } : instance
    )))
  }, [updateInstances])

  const updateSunIntensity = useCallback((intensity: number) => {
    if (!Number.isFinite(intensity)) return
    setSun((current) => {
      if (current.intensity === intensity) return current
      setSaveStatus('idle')
      return { ...current, intensity }
    })
  }, [])

  const updateEnvironmentIntensity = useCallback((environmentIntensity: number) => {
    if (!Number.isFinite(environmentIntensity)) return
    setSun((current) => {
      if (current.environmentIntensity === environmentIntensity) return current
      setSaveStatus('idle')
      return { ...current, environmentIntensity }
    })
  }, [])

  const updateSunRotation = useCallback((axis: TransformAxis, value: number) => {
    if (!Number.isFinite(value)) return
    setSun((current) => {
      if (current.rotation[axis] === value) return current
      const rotation = [...current.rotation] as [number, number, number]
      rotation[axis] = value
      setSaveStatus('idle')
      return { ...current, rotation }
    })
  }, [])

  const defaultGroundPlaneOffset = useCallback((metricScaleFactor: number) => (
    scaledGroundPlaneOffset(baseGroundPlaneOffset, metricScaleFactor, baseMetricScaleFactor)
  ), [baseGroundPlaneOffset, baseMetricScaleFactor])

  const updateMetricScaleFactor = useCallback((nextMetricScaleFactor: number) => {
    if (!Number.isFinite(nextMetricScaleFactor) || nextMetricScaleFactor <= 0) return
    const previousMetricScaleFactor = metricScaleFactorRef.current
    setMetricScaleFactor((current) => {
      if (current === nextMetricScaleFactor) return current
      setSaveStatus('idle')
      return nextMetricScaleFactor
    })
    setGroundPlaneOffset((current) => {
      const previousDefault = defaultGroundPlaneOffset(previousMetricScaleFactor)
      if (Math.abs(current - previousDefault) > VALUE_EPSILON) return current
      const nextDefault = defaultGroundPlaneOffset(nextMetricScaleFactor)
      return current === nextDefault ? current : nextDefault
    })
  }, [defaultGroundPlaneOffset])

  const resetMetricScaleFactor = useCallback(() => {
    updateMetricScaleFactor(baseMetricScaleFactor)
  }, [baseMetricScaleFactor, updateMetricScaleFactor])

  const updateGroundPlaneOffset = useCallback((nextGroundPlaneOffset: number) => {
    if (!Number.isFinite(nextGroundPlaneOffset)) return
    setGroundPlaneOffset((current) => {
      if (current === nextGroundPlaneOffset) return current
      setSaveStatus('idle')
      return nextGroundPlaneOffset
    })
  }, [])

  const resetGroundPlaneOffset = useCallback(() => {
    updateGroundPlaneOffset(defaultGroundPlaneOffset(metricScaleFactorRef.current))
  }, [defaultGroundPlaneOffset, updateGroundPlaneOffset])

  const updateGroundPlaneColliderEnabled = useCallback((enabled: boolean) => {
    setGroundPlaneColliderEnabled((current) => {
      if (current === enabled) return current
      setSaveStatus('idle')
      return enabled
    })
  }, [])

  const updateShadowCatcherOpacity = useCallback((nextShadowCatcherOpacity: number) => {
    if (!Number.isFinite(nextShadowCatcherOpacity)) return
    const clampedOpacity = normalizeShadowCatcherOpacity(nextShadowCatcherOpacity)
    setShadowCatcherOpacity((current) => {
      if (current === clampedOpacity) return current
      setSaveStatus('idle')
      return clampedOpacity
    })
  }, [])

  const resetShadowCatcherOpacity = useCallback(() => {
    updateShadowCatcherOpacity(DEFAULT_SHADOW_CATCHER_OPACITY)
  }, [updateShadowCatcherOpacity])

  const updateShadowCatcherColor = useCallback((nextShadowCatcherColor: string) => {
    const normalizedColor = normalizeShadowCatcherColor(nextShadowCatcherColor)
    setShadowCatcherColor((current) => {
      if (current === normalizedColor) return current
      setSaveStatus('idle')
      return normalizedColor
    })
  }, [])

  const resetShadowCatcherColor = useCallback(() => {
    updateShadowCatcherColor(DEFAULT_SHADOW_CATCHER_COLOR)
  }, [updateShadowCatcherColor])

  const undo = useCallback(() => {
    const snapshot = historyRef.current.past[historyRef.current.past.length - 1]
    if (!snapshot) return
    historyRef.current.past = historyRef.current.past.slice(0, -1)
    historyRef.current.future = [clonePlacements(instancesRef.current), ...historyRef.current.future]
    setInstances(clonePlacements(snapshot))
    setSaveStatus('idle')
  }, [])

  const redo = useCallback(() => {
    const snapshot = historyRef.current.future[0]
    if (!snapshot) return
    historyRef.current.future = historyRef.current.future.slice(1)
    historyRef.current.past = [...historyRef.current.past, clonePlacements(instancesRef.current)].slice(-HISTORY_LIMIT)
    setInstances(clonePlacements(snapshot))
    setSaveStatus('idle')
  }, [])

  const resetEdits = useCallback(() => {
    updateInstances(() => clonePlacements(baseline.instances))
    setSun(cloneSun(baseline.sun))
    setMetricScaleFactor(baseline.metricScaleFactor)
    setGroundPlaneOffset(baseline.groundPlaneOffset)
    setGroundPlaneColliderEnabled(baseline.groundPlaneColliderEnabled)
    setShadowCatcherOpacity(baseline.shadowCatcherOpacity)
    setShadowCatcherColor(baseline.shadowCatcherColor)
    setSelectedId(null)
  }, [baseline, updateInstances])

  const openWorldFolder = useCallback(() => {
    if (!import.meta.env.DEV) return
    fetch(`/__open-world-folder?slug=${encodeURIComponent(slug)}&target=scene`).catch((error) => {
      console.warn(`Could not open scene folder for "${slug}".`, error)
    })
  }, [slug])

  const saveProject = useCallback(async () => {
    if (!import.meta.env.DEV) return true
    try {
      const flushedInstances = flushSelectedTransformHandlerRef.current?.()
      const project: WorldSceneProject = {
        version: projectVersion,
        instances: clonePlacements(flushedInstances ?? instancesRef.current),
        sun: cloneSun(sunRef.current),
        metricScaleFactor: metricScaleFactorRef.current,
        groundPlaneOffset: groundPlaneOffsetRef.current,
        groundPlaneColliderEnabled: groundPlaneColliderEnabledRef.current,
        shadowCatcherOpacity: shadowCatcherOpacityRef.current,
        shadowCatcherColor: shadowCatcherColorRef.current,
      }
      setSaveStatus('saving')
      const response = await fetch(`/__scene-project?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      })
      if (!response.ok) throw new Error(await response.text())
      const savedProject = await response.json() as WorldSceneProject
      const savedMetricScaleFactor = savedProject.metricScaleFactor ?? baseMetricScaleFactor
      const savedGroundPlaneOffset = savedProject.groundPlaneOffset ??
        scaledGroundPlaneOffset(baseGroundPlaneOffset, savedMetricScaleFactor, baseMetricScaleFactor)
      const savedShadowCatcherOpacity = normalizeShadowCatcherOpacity(savedProject.shadowCatcherOpacity)
      const savedShadowCatcherColor = normalizeShadowCatcherColor(savedProject.shadowCatcherColor)
      const savedInstances = clonePlacements(savedProject.instances)
      const savedSun = cloneSun(savedProject.sun)
      setBaseline({
        slug,
        instances: savedInstances,
        sun: savedSun,
        metricScaleFactor: savedMetricScaleFactor,
        groundPlaneOffset: savedGroundPlaneOffset,
        groundPlaneColliderEnabled: savedProject.groundPlaneColliderEnabled ?? true,
        shadowCatcherOpacity: savedShadowCatcherOpacity,
        shadowCatcherColor: savedShadowCatcherColor,
        signature: editorStateSignature(
          savedInstances,
          savedSun,
          savedMetricScaleFactor,
          savedGroundPlaneOffset,
          savedProject.groundPlaneColliderEnabled ?? true,
          savedShadowCatcherOpacity,
          savedShadowCatcherColor,
        ),
      })
      setInstances(clonePlacements(savedInstances))
      setSun(cloneSun(savedSun))
      setMetricScaleFactor(savedMetricScaleFactor)
      setGroundPlaneOffset(savedGroundPlaneOffset)
      setGroundPlaneColliderEnabled(savedProject.groundPlaneColliderEnabled ?? true)
      setShadowCatcherOpacity(savedShadowCatcherOpacity)
      setShadowCatcherColor(savedShadowCatcherColor)
      onProjectSaved?.(savedProject)
      setSaveStatus('saved')
      return true
    } catch (error) {
      console.warn('Failed to save scene project.', error)
      setSaveStatus('error')
      return false
    }
  }, [baseGroundPlaneOffset, baseMetricScaleFactor, onProjectSaved, slug])

  useEffect(() => {
    if (!editing || !sceneProjectReady || sceneProject || !objects.length || !import.meta.env.DEV) return
    const project: WorldSceneProject = {
      version: projectVersion,
      instances: clonePlacements(baseline.instances),
      sun: cloneSun(baseline.sun),
      metricScaleFactor: baseline.metricScaleFactor,
      groundPlaneOffset: baseline.groundPlaneOffset,
      groundPlaneColliderEnabled: baseline.groundPlaneColliderEnabled,
      shadowCatcherOpacity: baseline.shadowCatcherOpacity,
      shadowCatcherColor: baseline.shadowCatcherColor,
    }
    fetch(`/__scene-project?slug=${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    })
      .then(async (response) => {
        if (!response.ok) return
        const savedProject = await response.json() as WorldSceneProject
        onProjectSaved?.(savedProject)
      })
      .catch((error) => {
        console.warn('Failed to initialize scene project.', error)
      })
  }, [baseline, editing, objects.length, onProjectSaved, sceneProject, sceneProjectReady, slug])

  useEffect(() => {
    if (!editing || !dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, editing])

  useEffect(() => {
    if (!editing) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (isEditableTarget(target)) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          if (target instanceof HTMLElement) target.blur()
        }
        return
      }
      const mod = event.metaKey || event.ctrlKey

      if (mod && event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault()
        redo()
        return
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (mod && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        copySelected()
        return
      }
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        pasteInstances()
        return
      }
      if (event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelected()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelected()
        return
      }
      if (event.key === '1') setMode('translate')
      if (event.key === '2') setMode('rotate')
      if (event.key === '3') setMode('scale')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copySelected, deleteSelected, duplicateSelected, editing, pasteInstances, redo, undo])

  return {
    slug,
    objects,
    allObjectAssets,
    visibleAssetLibrary,
    assetFilter,
    setAssetFilter,
    assetsById,
    instances,
    selectedId,
    hoveredObjectAssetId,
    hoveredObjectInstanceId,
    selectedInstance,
    mode,
    setMode,
    saveStatus,
    dirty,
    canUndo,
    canRedo,
    setSelectedId,
    selectInstance,
    selectFromOverlay,
    hoverAsset,
    commitInstances,
    duplicateSelected,
    duplicateInstance,
    deleteSelected,
    deleteInstance,
    addAsset,
    dropSelectedToFloor,
    setDropSelectedToFloorHandler,
    updateSelectedTransform,
    updateSelectedPhysics,
    sun,
    updateSunIntensity,
    updateEnvironmentIntensity,
    updateSunRotation,
    metricScaleFactor,
    resetMetricScaleFactor,
    updateMetricScaleFactor,
    groundPlaneOffset,
    resetGroundPlaneOffset,
    updateGroundPlaneOffset,
    groundPlaneColliderEnabled,
    updateGroundPlaneColliderEnabled,
    shadowCatcherOpacity,
    resetShadowCatcherOpacity,
    updateShadowCatcherOpacity,
    shadowCatcherColor,
    resetShadowCatcherColor,
    updateShadowCatcherColor,
    undo,
    redo,
    resetEdits,
    openWorldFolder,
    saveProject,
    setFlushSelectedTransformHandler,
  }
}

export function PlacementEditorScene({ controller, renderMode }: PlacementEditorSceneProps) {
  const { camera, scene } = useThree()
  const transformRef = useRef<any>(null)
  const selectedObjectRef = useRef<THREE.Group>(null)
  const selectionSuppressedRef = useRef(false)
  const selectionSuppressionTimeoutRef = useRef<number | undefined>(undefined)
  const [selectedObject, setSelectedObject] = useState<THREE.Group>()
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null)
  const dragStartRef = useRef<WorldObjectPlacement | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const selectedInstance = controller.selectedInstance
  const selectedAsset = selectedInstance
    ? controller.assetsById.get(placementAssetKey(selectedInstance)) ?? controller.assetsById.get(selectedInstance.objectId)
    : undefined

  const bakeSelectedTransform = useCallback(() => {
    const selected = controller.selectedInstance
    const object = selectedObjectRef.current
    if (!selected || !object) return null

    const next = controller.instances.map((instance) => {
      if (instance.instanceId !== selected.instanceId) return instance

      object.updateWorldMatrix(true, false)
      const position = new THREE.Vector3()
      const quaternion = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      object.matrixWorld.decompose(position, quaternion, scale)

      return {
        ...instance,
        position: asTuple(position),
        rotation: eulerTuple(quaternion),
        scale: asTuple(scale),
      }
    })

    controller.commitInstances(next)
    dragStartRef.current = null
    return next
  }, [controller])

  useEffect(() => {
    const controls = transformRef.current as any
    if (!controls) return
    const captureDragStart = () => {
      selectionSuppressedRef.current = true
      if (selectionSuppressionTimeoutRef.current !== undefined) {
        window.clearTimeout(selectionSuppressionTimeoutRef.current)
        selectionSuppressionTimeoutRef.current = undefined
      }
      dragStartRef.current = controller.selectedInstance ? clonePlacements([controller.selectedInstance])[0] : null
    }
    const bakeDragEnd = (event: { value?: boolean }) => {
      if (event.value !== false) return
      bakeSelectedTransform()
      selectionSuppressionTimeoutRef.current = window.setTimeout(() => {
        selectionSuppressedRef.current = false
        selectionSuppressionTimeoutRef.current = undefined
      }, 120)
    }
    controls.addEventListener('mouseDown', captureDragStart)
    controls.addEventListener('dragging-changed', bakeDragEnd)
    return () => {
      if (selectionSuppressionTimeoutRef.current !== undefined) {
        window.clearTimeout(selectionSuppressionTimeoutRef.current)
        selectionSuppressionTimeoutRef.current = undefined
      }
      selectionSuppressedRef.current = false
      controls.removeEventListener('mouseDown', captureDragStart)
      controls.removeEventListener('dragging-changed', bakeDragEnd)
    }
  }, [bakeSelectedTransform, controller.selectedInstance])

  const selectInstance = useCallback((event: ThreeEvent<MouseEvent>, instanceId: string) => {
    if (selectionSuppressedRef.current) {
      event.stopPropagation()
      return
    }
    controller.selectInstance(event, nearestEditableObjectInstanceId(event, instanceId, camera))
  }, [camera, controller])

  const hoverInstance = useCallback((event: ThreeEvent<PointerEvent>, instanceId: string) => {
    setHoveredInstanceId(nearestEditableObjectInstanceId(event, instanceId, camera))
  }, [camera])

  const clearHoveredInstance = useCallback((_event: ThreeEvent<PointerEvent>, instanceId: string) => {
    setHoveredInstanceId((current) => (current === instanceId ? null : current))
  }, [])

  useEffect(() => {
    controller.setFlushSelectedTransformHandler(bakeSelectedTransform)
    return () => controller.setFlushSelectedTransformHandler(null)
  }, [bakeSelectedTransform, controller])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (blurEditableTarget(event.target)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      const dragStart = dragStartRef.current
      const object = selectedObjectRef.current
      if (dragStart && object) {
        event.preventDefault()
        object.position.set(...dragStart.position)
        object.rotation.set(...dragStart.rotation)
        object.scale.set(...dragStart.scale)
        object.updateMatrixWorld(true)
        dragStartRef.current = null
        return
      }

      if (controller.selectedId) {
        event.preventDefault()
        controller.setSelectedId(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller])

  const dropSelectedToFloor = useCallback(() => {
    const selected = controller.selectedInstance
    if (!selected) return
    const selectedGroup = selectedObjectRef.current
    const isSelectedObject = (object: THREE.Object3D) => {
      let current: THREE.Object3D | null = object
      while (current) {
        if (current === selectedGroup) return true
        current = current.parent
      }
      return false
    }
    const origin = new THREE.Vector3(...selected.position)
    if (selectedGroup) {
      selectedGroup.updateWorldMatrix(true, true)
      const bounds = new THREE.Box3().setFromObject(selectedGroup)
      selectedGroup.getWorldPosition(origin)
      origin.y = bounds.max.y + 0.25
    } else {
      origin.y += 0.25
    }
    const raycaster = raycasterRef.current
    raycaster.layers.set(DROP_TARGET_LAYER)
    raycaster.set(origin, new THREE.Vector3(0, -1, 0))
    const hit = raycaster
      .intersectObjects(scene.children, true)
      .find((intersection) => !isSelectedObject(intersection.object) && intersection.point.y <= origin.y)
    if (!hit) return

    const next = controller.instances.map((instance) => {
      if (instance.instanceId !== selected.instanceId) return instance
      return { ...instance, position: [instance.position[0], hit.point.y, instance.position[2]] as [number, number, number] }
    })
    controller.commitInstances(next)
  }, [controller, scene.children])

  useEffect(() => {
    controller.setDropSelectedToFloorHandler(dropSelectedToFloor)
    return () => controller.setDropSelectedToFloorHandler(null)
  }, [controller, dropSelectedToFloor])

  return (
    <>
      <group>
        {controller.instances.filter((instance) => instance.instanceId !== controller.selectedId).map((instance) => {
          const asset = controller.assetsById.get(placementAssetKey(instance)) ?? controller.assetsById.get(instance.objectId)
          if (!asset) return null
          return (
            <EditableObject
              key={instance.instanceId}
              asset={asset}
              placement={instance}
              selected={false}
              externallyHovered={
                hoveredInstanceId === instance.instanceId ||
                controller.hoveredObjectInstanceId === instance.instanceId ||
                (!controller.hoveredObjectInstanceId && controller.hoveredObjectAssetId === asset.assetId)
              }
              renderMode={renderMode}
              onSelect={selectInstance}
              onHover={hoverInstance}
              onHoverEnd={clearHoveredInstance}
            />
          )
        })}
        {selectedInstance && selectedAsset && (
          <>
            <EditableObject
              key={selectedInstance.instanceId}
              asset={selectedAsset}
              placement={selectedInstance}
              selected
              externallyHovered={
                hoveredInstanceId === selectedInstance.instanceId ||
                controller.hoveredObjectInstanceId === selectedInstance.instanceId ||
                (!controller.hoveredObjectInstanceId && controller.hoveredObjectAssetId === selectedAsset.assetId)
              }
              renderMode={renderMode}
              onSelect={selectInstance}
              onHover={hoverInstance}
              onHoverEnd={clearHoveredInstance}
              setRef={(group) => {
                if (selectedObjectRef.current === group) return
                selectedObjectRef.current = group
                setSelectedObject(group ?? undefined)
              }}
            />
            {selectedObject && (
              <TransformControls
                ref={transformRef}
                object={selectedObject}
                mode={controller.mode}
                space="local"
                rotationSnap={THREE.MathUtils.degToRad(ROTATION_SNAP_DEGREES)}
              />
            )}
          </>
        )}
      </group>
    </>
  )
}

export function PlacementEditorOverlay({ controller }: PlacementEditorOverlayProps) {
  const [, navigate] = useLocation()
  const selectedInstance = controller.selectedInstance
  const selectedAsset = selectedInstance
    ? controller.assetsById.get(placementAssetKey(selectedInstance)) ?? controller.assetsById.get(selectedInstance.objectId)
    : undefined
  const showSaveStatus = controller.saveStatus === 'error' || controller.saveStatus === 'saved' || !import.meta.env.DEV

  return (
    <div className="pointer-events-none fixed inset-0 z-20 text-sm text-white">
      <div className="pointer-events-auto fixed left-1/2 top-4 -translate-x-1/2">
        <div className={`${chrome.bar} flex flex-shrink-0 gap-1`}>
          <AppButton
            className={`justify-center ${controller.mode === 'translate' ? 'bg-white/15 opacity-100' : ''}`}
            onClick={() => controller.setMode('translate')}
            aria-label="Position tool"
          >
            <ArrowsOutCardinal size={15} weight="regular" />
            Position
          </AppButton>
          <AppButton
            className={`justify-center ${controller.mode === 'rotate' ? 'bg-white/15 opacity-100' : ''}`}
            onClick={() => controller.setMode('rotate')}
            aria-label="Rotation tool"
          >
            <ArrowClockwise size={15} weight="regular" />
            Rotation
          </AppButton>
          <AppButton
            className={`justify-center ${controller.mode === 'scale' ? 'bg-white/15 opacity-100' : ''}`}
            onClick={() => controller.setMode('scale')}
            aria-label="Scale tool"
          >
            <CornersOut size={15} weight="regular" />
            Scale
          </AppButton>
          <AppButton
            className="justify-center"
            disabled={!controller.selectedId}
            onClick={controller.dropSelectedToFloor}
            aria-label="Drop selected object to floor"
            title="Drop to floor"
          >
            <ArrowDown size={15} weight="regular" />
            Drop
          </AppButton>
        </div>
      </div>

      <ChromePanel className="pointer-events-auto fixed right-4 top-4 w-72 p-2 font-mono whitespace-nowrap">
        <div className="flex flex-col gap-1">
          {selectedInstance ? (
            <>
              <div className="mb-1 min-w-0">
                <div className="truncate text-xs font-medium text-white/90">{selectedAsset?.name ?? selectedInstance.objectId}</div>
                <div className="truncate text-[10px] text-white/35">{selectedInstance.instanceId}</div>
              </div>
              {TRANSFORM_FIELDS.map(({ field, label, step }) => (
                <div key={field} className="grid grid-cols-[2.75rem_repeat(3,minmax(0,1fr))] items-center gap-1">
                  <div className="text-[10px] tracking-[0.16em] text-white/40">{label}</div>
                  {TRANSFORM_AXES.map(({ axis, label: axisLabel }) => (
                    <label key={`${field}-${axis}`} className="min-w-0">
                      <span className="sr-only">{`${label} ${axisLabel}`}</span>
                      <TransformValueInput
                        field={field}
                        axis={axis}
                        step={step}
                        value={selectedInstance[field][axis]}
                        onChange={controller.updateSelectedTransform}
                      />
                    </label>
                  ))}
                </div>
              ))}
              <label className="grid grid-cols-[2.75rem_1fr] items-center gap-1">
                <span className="text-[10px] tracking-[0.16em] text-white/40">Body</span>
                <select
                  value={selectedInstance.physics ?? 'rigidbody'}
                  onChange={(event) => controller.updateSelectedPhysics(event.currentTarget.value as WorldObjectPhysics)}
                  className="h-7 rounded border border-white/10 bg-black/40 px-1.5 text-xs text-white/85"
                >
                  <option value="rigidbody">Rigidbody</option>
                  <option value="static">Static</option>
                  <option value="ghost">Ghost</option>
                </select>
              </label>
            </>
          ) : (
            <div className="pb-1 text-[10px] text-white/35">No object selected</div>
          )}
            <div className={`${selectedInstance ? 'border-t border-white/10 pt-1' : ''} grid grid-cols-[2.75rem_2.25rem_repeat(3,minmax(0,1fr))] items-center gap-1`}>
              <span className="text-[10px] tracking-[0.16em] text-white/40">Sun</span>
              <NumberValueInput
                value={controller.sun.intensity}
                step={0.01}
                onChange={controller.updateSunIntensity}
                className="h-6 text-[11px]"
              />
              {TRANSFORM_AXES.map(({ axis, label }) => (
                <label key={`sun-${axis}`} className="min-w-0">
                  <span className="sr-only">{`Sun rotation ${label}`}</span>
                  <NumberValueInput
                    value={controller.sun.rotation[axis]}
                    displayValue={THREE.MathUtils.radToDeg(controller.sun.rotation[axis])}
                    step={1}
                    toStoredValue={THREE.MathUtils.degToRad}
                    onChange={(value) => controller.updateSunRotation(axis, value)}
                    className="h-6 text-[11px]"
                  />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-[2.75rem_repeat(2,minmax(0,1fr))] items-center gap-1">
              <span className="text-[10px] tracking-[0.16em] text-white/40">Env</span>
              <NumberValueInput
                value={controller.sun.environmentIntensity ?? DEFAULT_SCENE_SUN.environmentIntensity ?? 2}
                step={0.01}
                onChange={controller.updateEnvironmentIntensity}
                className="h-6 text-[11px]"
              />
              <span className="text-[10px] tracking-[0.16em] text-white/40">HDRI</span>
            </div>
            <div className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-1">
              <span className="text-[10px] tracking-[0.16em] text-white/40">Shadow</span>
              <NumberValueInput
                value={controller.shadowCatcherOpacity}
                step={0.01}
                onChange={controller.updateShadowCatcherOpacity}
                className="h-6 text-[11px]"
              />
              <AppButton
                onClick={controller.resetShadowCatcherOpacity}
                className="h-6 px-1.5 py-0 text-[10px] text-white/55"
                aria-label="Reset shadow opacity"
                title="Reset shadow opacity"
              >
                Reset
              </AppButton>
            </div>
            <div className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-1">
              <span className="text-[10px] tracking-[0.16em] text-white/40">Color</span>
              <input
                type="color"
                value={controller.shadowCatcherColor}
                onChange={(event) => controller.updateShadowCatcherColor(event.currentTarget.value)}
                className="h-6 w-full cursor-pointer rounded border border-white/10 bg-black/40"
                aria-label="Shadow color"
              />
              <AppButton
                onClick={controller.resetShadowCatcherColor}
                className="h-6 px-1.5 py-0 text-[10px] text-white/55"
                aria-label="Reset shadow color"
                title="Reset shadow color"
              >
                Reset
              </AppButton>
            </div>
            <div className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-1">
              <span className="text-[10px] tracking-[0.16em] text-white/40">World</span>
              <NumberValueInput
                value={controller.metricScaleFactor}
                step={0.01}
                onChange={controller.updateMetricScaleFactor}
                className="h-6 text-[11px]"
              />
              <AppButton
                onClick={controller.resetMetricScaleFactor}
                className="h-6 px-1.5 py-0 text-[10px] text-white/55"
                aria-label="Reset world scale"
                title="Reset world scale"
              >
                Reset
              </AppButton>
            </div>
            <div className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-1">
              <span className="text-[10px] tracking-[0.16em] text-white/40">Ground</span>
              <NumberValueInput
                value={controller.groundPlaneOffset}
                step={0.01}
                onChange={controller.updateGroundPlaneOffset}
                className="h-6 text-[11px]"
              />
              <AppButton
                onClick={controller.resetGroundPlaneOffset}
                className="h-6 px-1.5 py-0 text-[10px] text-white/55"
                aria-label="Reset ground offset"
                title="Reset ground offset"
              >
                Reset
              </AppButton>
            </div>
            <div className="grid grid-cols-[2.75rem_1fr] items-center gap-1">
              <span className="text-[10px] tracking-[0.16em] text-white/40">Floor</span>
              <AppButton
                active={controller.groundPlaneColliderEnabled}
                onClick={() => controller.updateGroundPlaneColliderEnabled(!controller.groundPlaneColliderEnabled)}
                className={`h-6 justify-center px-1.5 py-0 text-[10px] ${controller.groundPlaneColliderEnabled ? 'bg-white/15 opacity-100' : 'text-white/55'}`}
                aria-label={controller.groundPlaneColliderEnabled ? 'Disable flat ground floor collider' : 'Enable flat ground floor collider'}
                aria-pressed={controller.groundPlaneColliderEnabled}
                title="Flat ground floor collider"
              >
                {controller.groundPlaneColliderEnabled ? 'Collider On' : 'Collider Off'}
              </AppButton>
            </div>
        </div>
      </ChromePanel>

      <div className={`${chrome.enter} fixed left-4 top-28 flex max-h-[calc(100vh-8rem)] w-64 max-w-[calc(100vw-2rem)] flex-col gap-1 whitespace-nowrap text-sm`}>
        <div className="flex min-h-0 flex-col gap-1">
          <div className={twMerge(chrome.bar, 'pointer-events-auto')}>
            <div className="flex items-center justify-between gap-1">
              <div className="flex min-w-0 items-center gap-1">
                <a
                  className="inline-flex h-7 w-7 items-center justify-center rounded p-1 text-xs opacity-80 transition-[background-color,opacity] hover:bg-white/10 hover:opacity-100"
                  href={`/${controller.slug}`}
                  aria-label="Return to world"
                  onClick={(event) => {
                    event.preventDefault()
                    if (controller.dirty && !window.confirm('You have unsaved scene changes. Leave without saving?')) return
                    navigate(`/${controller.slug}`)
                  }}
                >
                  <ArrowLeft size={16} weight="regular" />
                </a>
                <AppButton
                  className={`h-7 w-7 justify-center p-1 ${controller.dirty ? 'text-yellow-300 opacity-100' : ''}`}
                  disabled={!import.meta.env.DEV || controller.saveStatus === 'saving'}
                  onClick={controller.saveProject}
                  aria-label={controller.dirty ? 'Save unsaved scene changes' : 'Save project'}
                  title={controller.dirty ? 'Unsaved changes' : 'Saved'}
                >
                  <FloppyDisk size={16} weight="regular" />
                </AppButton>
                <AppButton
                  className="h-7 w-7 justify-center p-1"
                  disabled={!import.meta.env.DEV}
                  onClick={controller.openWorldFolder}
                  aria-label="Open world folder"
                >
                  <FolderOpen size={16} weight="regular" />
                </AppButton>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <AppButton
                  className="h-7 w-7 justify-center p-1"
                  disabled={!controller.canUndo}
                  onClick={controller.undo}
                  aria-label="Undo"
                >
                  <ArrowUUpLeft size={16} weight="regular" />
                </AppButton>
                <AppButton
                  className="h-7 w-7 justify-center p-1"
                  disabled={!controller.canRedo}
                  onClick={controller.redo}
                  aria-label="Redo"
                >
                  <ArrowUUpRight size={16} weight="regular" />
                </AppButton>
              </div>
            </div>
            {showSaveStatus && (
              <div className="mt-1 text-xs leading-4 text-white/65">
                {controller.saveStatus === 'error' && <div className="text-red-300">Save failed.</div>}
                {controller.saveStatus === 'saved' && <div className="text-green-300">Saved scene.json.</div>}
                {!import.meta.env.DEV && <div>Saving and folder opening are available in dev only.</div>}
              </div>
            )}
          </div>

          <ChromePanel className="pointer-events-auto min-h-0 overflow-hidden">
            <div className={chrome.sectionHeader}>
              <span>Scene Graph</span>
              <span className="normal-case tracking-normal">{controller.selectedId ? '1 selected' : 'None selected'}</span>
            </div>
            <div className="max-h-[34vh] overflow-y-auto overflow-x-hidden">
              <div className="p-1 pr-2">
              {controller.instances.map((instance) => {
                const asset = controller.assetsById.get(placementAssetKey(instance)) ?? controller.assetsById.get(instance.objectId)
                const selected = controller.selectedId === instance.instanceId
                return (
                  <div
                    key={instance.instanceId}
                    className={`${chrome.row} ${selected ? chrome.rowActive : chrome.rowIdle}`}
                    onMouseEnter={() => {
                      if (asset) controller.hoverAsset(asset, true, instance.instanceId)
                    }}
                    onMouseLeave={() => {
                      if (asset) controller.hoverAsset(asset, false, instance.instanceId)
                    }}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left"
                      onClick={() => controller.selectFromOverlay(instance.instanceId)}
                    >
                      <ChromeThumbnail thumbnailUrl={asset?.thumbnailUrl} alt={asset?.name ?? instance.objectId} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-xs text-white/90">{asset?.name ?? instance.objectId}</span>
                          {asset?.variantLabel && (
                            <span className="flex-shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] leading-none text-white/50">
                              {asset.variantLabel}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-[10px] text-white/35">{instance.instanceId}</span>
                      </span>
                    </button>
                    <div className="flex flex-shrink-0 items-center gap-0.5 px-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <AppButton
                        className="h-7 w-7 justify-center"
                        onClick={(event) => {
                          event.stopPropagation()
                          controller.duplicateInstance(instance.instanceId)
                        }}
                        aria-label={`Duplicate ${asset?.name ?? instance.objectId}`}
                      >
                        <Copy size={14} weight="regular" />
                      </AppButton>
                      <AppButton
                        className="h-7 w-7 justify-center text-red-200"
                        onClick={(event) => {
                          event.stopPropagation()
                          controller.deleteInstance(instance.instanceId)
                        }}
                        aria-label={`Delete ${asset?.name ?? instance.objectId}`}
                      >
                        <Trash size={14} weight="regular" />
                      </AppButton>
                    </div>
                  </div>
                )
              })}
              {!controller.instances.length && (
                <div className="px-2 py-3 text-xs text-white/45">No object instances in this scene.</div>
              )}
              </div>
            </div>
          </ChromePanel>

          <ChromePanel className="pointer-events-auto min-h-0 overflow-hidden">
            <div className={chrome.sectionHeader}>
              <span>Assets</span>
              <div className="flex items-center gap-1 normal-case tracking-normal">
                <AppButton
                  active={controller.assetFilter === 'world'}
                  className={`h-7 justify-center ${controller.assetFilter === 'world' ? 'bg-white/15 opacity-100' : ''}`}
                  onClick={() => controller.setAssetFilter('world')}
                  aria-label="Show this world's objects"
                  title="World objects"
                >
                  <Cube size={14} weight="regular" />
                  World
                </AppButton>
                <AppButton
                  active={controller.assetFilter === 'all'}
                  className={`h-7 justify-center ${controller.assetFilter === 'all' ? 'bg-white/15 opacity-100' : ''}`}
                  onClick={() => controller.setAssetFilter('all')}
                  aria-label="Show all objects"
                  title="All objects"
                >
                  <GlobeSimple size={14} weight="regular" />
                  All
                </AppButton>
              </div>
            </div>
            <div className="max-h-[28vh] overflow-y-auto overflow-x-hidden">
              <div className="p-1 pr-2">
              {controller.visibleAssetLibrary.map((asset) => (
                <div
                  key={assetKey(asset)}
                  className="group flex items-center gap-1 rounded opacity-80 transition-[background-color,opacity] hover:bg-white/10 hover:opacity-100"
                  onMouseEnter={() => controller.hoverAsset(asset, true)}
                  onMouseLeave={() => controller.hoverAsset(asset, false)}
                >
                  <button
                    type="button"
                    className="min-w-0 flex flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left"
                    onClick={() => controller.addAsset(asset)}
                  >
                    <ChromeThumbnail thumbnailUrl={asset.thumbnailUrl} alt={asset.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-white/90">{asset.name}</span>
                      <span className="block truncate text-[10px] text-white/35">
                        {[asset.sourceWorldSlug, asset.variantLabel].filter(Boolean).join(' / ')}
                      </span>
                    </span>
                  </button>
                  <AppButton
                    className="mr-0.5 h-7 w-7 justify-center opacity-0 group-hover:opacity-100"
                    onClick={() => controller.addAsset(asset)}
                    aria-label={`Add ${asset.name} to scene`}
                    title={`Add ${asset.name}`}
                  >
                    <Plus size={14} weight="regular" />
                  </AppButton>
                </div>
              ))}
              {!controller.visibleAssetLibrary.length && (
                <div className="px-2 py-3 text-xs text-white/45">No object assets found.</div>
              )}
              </div>
            </div>
          </ChromePanel>
        </div>
      </div>
    </div>
  )
}
