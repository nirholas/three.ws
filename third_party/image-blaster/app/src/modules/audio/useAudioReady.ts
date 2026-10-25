import { useEffect, useState } from 'react'
import * as THREE from 'three'

let ready = false
const listeners = new Set<() => void>()

function markReady() {
  if (ready) return
  ready = true
  const ctx = THREE.AudioContext.getContext()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  listeners.forEach((listener) => listener())
  listeners.clear()
}

if (typeof window !== 'undefined') {
  const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart']
  const onGesture = () => {
    markReady()
    events.forEach((event) => window.removeEventListener(event, onGesture))
  }
  events.forEach((event) => window.addEventListener(event, onGesture, { once: false }))
}

export function useAudioReady(): boolean {
  const [isReady, setIsReady] = useState(ready)

  useEffect(() => {
    if (ready) {
      setIsReady(true)
      return
    }

    const listener = () => setIsReady(true)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return isReady
}
