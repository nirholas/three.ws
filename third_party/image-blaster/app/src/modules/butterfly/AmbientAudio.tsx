import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useButterflyStore } from './store'
import { useAudioReady } from '../audio/useAudioReady'
import { useAudioStore } from '../../store/audio'

const URL = '/butterfly/sfx/ambient-loop.wav'

export function AmbientAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ready = useAudioReady()

  useEffect(() => {
    if (!ready) return
    const a = new Audio(URL)
    a.loop = true
    a.volume = useButterflyStore.getState().ambientVolume
    audioRef.current = a
    a.play().catch(() => {})

    return () => {
      a.pause()
      a.src = ''
      audioRef.current = null
    }
  }, [ready])

  useFrame(() => {
    const a = audioRef.current
    if (!a) return
    const v = useButterflyStore.getState().ambientVolume
    const muted = useAudioStore.getState().muted
    a.volume = muted ? 0 : Math.max(0, Math.min(1, v))
  })

  return null
}
