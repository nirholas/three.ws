import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useButterflyStore } from './store'
import { useAudioReady } from '../audio/useAudioReady'
import { useAudioStore } from '../../store/audio'

const URL = '/butterfly/sfx/wing-flap-loop.wav'

interface Props {
  angularIntensityRef: React.RefObject<number>
}

export function WindAudio({ angularIntensityRef }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mixRef = useRef(0)
  const tRef = useRef(0)
  const ready = useAudioReady()

  useEffect(() => {
    if (!ready) return
    const a = new Audio(URL)
    a.loop = true
    a.volume = 0
    audioRef.current = a
    a.play().catch(() => {})
    return () => {
      a.pause()
      a.src = ''
      audioRef.current = null
    }
  }, [ready])

  useFrame((_, dtRaw) => {
    const a = audioRef.current
    if (!a) return
    const dt = Math.min(dtRaw, 0.05)
    tRef.current += dt
    const p = useButterflyStore.getState()
    const ang = Math.max(0, Math.min(1, angularIntensityRef.current ?? 0))
    const k = 1 - Math.exp(-p.windLerpSpeed * dt)
    mixRef.current += (ang - mixRef.current) * k
    const sine = 0.5 + 0.5 * Math.sin(tRef.current * p.windSineFreq)
    const env = 1 - p.windSineDepth + p.windSineDepth * sine
    const muted = useAudioStore.getState().muted
    a.volume = muted ? 0 : Math.max(0, Math.min(1, mixRef.current * env * p.windVolume))
  })

  return null
}
