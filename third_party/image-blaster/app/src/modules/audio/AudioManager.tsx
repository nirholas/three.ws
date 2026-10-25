import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAudioStore } from '../../store/audio'
import { useAudioReady } from './useAudioReady'

const BASE_VOLUME = 0.6

interface Props {
  urls: string[]
}

function WorldAudioPlayer({ urls }: Props) {
  const camera = useThree((state) => state.camera)
  const muted = useAudioStore((state) => state.muted)
  const buffers = useLoader(THREE.AudioLoader, urls) as AudioBuffer[]
  const soundsRef = useRef<THREE.Audio[]>([])
  const listener = useMemo(() => new THREE.AudioListener(), [])

  const startSounds = useCallback(() => {
    if (listener.context.state === 'suspended') listener.context.resume().catch(() => {})
    soundsRef.current.forEach((sound) => {
      if (!sound.isPlaying) sound.play()
    })
  }, [listener])

  useEffect(() => {
    camera.add(listener)
    return () => {
      listener.removeFromParent()
    }
  }, [camera, listener])

  useEffect(() => {
    const sounds = buffers.map((buffer) => {
      const sound = new THREE.Audio(listener)
      sound.setBuffer(buffer)
      sound.setLoop(true)
      sound.setVolume(useAudioStore.getState().muted ? 0 : BASE_VOLUME)
      return sound
    })

    soundsRef.current = sounds
    if (!useAudioStore.getState().muted) startSounds()

    return () => {
      sounds.forEach((sound) => {
        if (sound.isPlaying) sound.stop()
        sound.disconnect()
      })
      soundsRef.current = []
    }
  }, [buffers, listener, startSounds])

  useEffect(() => {
    soundsRef.current.forEach((sound) => {
      sound.setVolume(muted ? 0 : BASE_VOLUME)
    })
    if (muted) {
      soundsRef.current.forEach((sound) => {
        if (sound.isPlaying) sound.stop()
      })
    } else {
      startSounds()
    }
  }, [muted, startSounds])

  return null
}

export function AudioManager({ urls }: Props) {
  const ready = useAudioReady()
  const audioKey = urls.join('\0')

  if (!ready || urls.length === 0) return null

  return <WorldAudioPlayer key={audioKey} urls={urls} />
}
