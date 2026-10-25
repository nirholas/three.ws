import {
  GlobeSimple,
  Sphere,
  GlobeHemisphereEast,
  ParkIcon,
  MountainsIcon,
  CubeIcon,
} from '@phosphor-icons/react'
import { Tooltip } from '@radix-ui/themes'
import { type ReactElement, useEffect } from 'react'
import { useDebugStore } from '../store/debug'
import { ObjectRenderMode, ViewerQuality, WorldRenderMode } from '../types/world'
import { isEditableTarget } from '../utils/dom'
import { AppButton } from './AppButton'
import { chrome } from './AppChrome'

const OBJECT_MODES = [
  { mode: ObjectRenderMode.Lit, Icon: GlobeHemisphereEast, label: 'Lit' },
  { mode: ObjectRenderMode.ShadedWireframe, Icon: Sphere, label: 'Shaded Wireframe' },
  { mode: ObjectRenderMode.Wireframe, Icon: GlobeSimple, label: 'Wireframe' },
] as const

const WORLD_MODES = [
  { mode: WorldRenderMode.Combined, Icon: ParkIcon, label: 'Scene + Objects' },
  { mode: WorldRenderMode.SplatOnly, Icon: MountainsIcon, label: 'Scene' },
  { mode: WorldRenderMode.ObjectOnly, Icon: CubeIcon, label: 'Objects' },
] as const

const DIGIT_KEY_INDEX: Record<string, number> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
}

const QUALITY_MODE_KEYS = [ViewerQuality.Low, ViewerQuality.High] as const
const OBJECT_MODE_KEYS = [ObjectRenderMode.Lit, ObjectRenderMode.ShadedWireframe, ObjectRenderMode.Wireframe] as const
const WORLD_MODE_KEYS = [WorldRenderMode.Combined, WorldRenderMode.SplatOnly, WorldRenderMode.ObjectOnly] as const

function ControlTooltip({ content, children }: { content: string; children: ReactElement }) {
  return (
    <Tooltip content={content} delayDuration={0} side="top">
      {children}
    </Tooltip>
  )
}

export function ViewerModeHotkeys() {
  const setViewerQuality = useDebugStore((s) => s.setViewerQuality)
  const setObjectRenderMode = useDebugStore((s) => s.setObjectRenderMode)
  const setWorldRenderMode = useDebugStore((s) => s.setWorldRenderMode)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const n = DIGIT_KEY_INDEX[e.code]
      if (n === undefined) return
      if (e.altKey && e.shiftKey) {
        const quality = QUALITY_MODE_KEYS[n]
        if (quality) {
          e.preventDefault()
          setViewerQuality(quality)
        }
      } else if (e.altKey) {
        e.preventDefault()
        setObjectRenderMode(OBJECT_MODE_KEYS[n])
      } else if (e.shiftKey) {
        e.preventDefault()
        setWorldRenderMode(WORLD_MODE_KEYS[n])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setObjectRenderMode, setViewerQuality, setWorldRenderMode])

  return null
}

export function BottomLeftControls() {
  const objectRenderMode = useDebugStore((s) => s.objectRenderMode)
  const setObjectRenderMode = useDebugStore((s) => s.setObjectRenderMode)
  const worldRenderMode = useDebugStore((s) => s.worldRenderMode)
  const setWorldRenderMode = useDebugStore((s) => s.setWorldRenderMode)

  const modeBtn = (active: boolean) =>
    `w-8 h-8 justify-center rounded ${
      active ? 'bg-white/15 text-white' : 'text-white'
    }`

  return (
    <div className={`${chrome.enter} flex w-full items-center justify-center gap-2 sm:w-auto`}>
      <div className={`${chrome.bar} flex h-10 items-center gap-1`}>
        {WORLD_MODES.map(({ mode, Icon, label }) => (
          <ControlTooltip key={mode} content={label}>
            <AppButton
              onClick={() => setWorldRenderMode(mode)}
              active={worldRenderMode === mode}
              className={modeBtn(worldRenderMode === mode)}
            >
              <Icon size={17} weight={worldRenderMode === mode ? 'fill' : 'regular'} />
            </AppButton>
          </ControlTooltip>
        ))}
      </div>

      <div className={`${chrome.bar} flex h-10 items-center gap-1`}>
        {OBJECT_MODES.map(({ mode, Icon, label }) => (
          <ControlTooltip key={mode} content={label}>
            <AppButton
              onClick={() => setObjectRenderMode(mode)}
              active={objectRenderMode === mode}
              className={modeBtn(objectRenderMode === mode)}
            >
              <Icon size={17} weight={objectRenderMode === mode ? 'fill' : 'regular'} />
            </AppButton>
          </ControlTooltip>
        ))}
      </div>
    </div>
  )
}
