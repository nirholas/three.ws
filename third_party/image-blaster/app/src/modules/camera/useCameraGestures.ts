import { useEffect } from 'react'

interface Props {
  domElement: HTMLElement
  onDollyPixels: (delta: number) => void
  onTumblePixels: (dx: number, dy: number) => void
}

export function useCameraGestures({ domElement, onDollyPixels, onTumblePixels }: Props) {
  useEffect(() => {
    let rightDragging = false
    let lastMouseX = 0
    let lastMouseY = 0
    let twoFingerActive = false
    let lastPinchDist = 0
    let lastTouchX = 0
    let lastTouchY = 0

    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return
      rightDragging = true
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      e.preventDefault()
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!rightDragging) return
      if (document.pointerLockElement === domElement) return
      const dx = e.clientX - lastMouseX
      const dy = e.clientY - lastMouseY
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      onTumblePixels(dx, dy)
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) rightDragging = false
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey) {
        // trackpad pinch-to-zoom
        onDollyPixels(e.deltaY)
        return
      }
      // Trackpad two-finger drag reports as pixel-mode wheel, including vertical drags.
      // Treat it as look/tumble; translation stays on fly keys and zoom stays on pinch/wheel.
      if (e.deltaMode === 0) {
        onTumblePixels(-e.deltaX, -e.deltaY)
        return
      }
      // Mouse wheel zooms on non-pixel wheel events.
      onDollyPixels(e.deltaY)
    }

    const touchDist = (t: TouchList) =>
      Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY)

    const touchCenter = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    })

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) { twoFingerActive = false; return }
      twoFingerActive = true
      lastPinchDist = touchDist(e.touches)
      const c = touchCenter(e.touches)
      lastTouchX = c.x
      lastTouchY = c.y
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) { twoFingerActive = false; return }
      e.preventDefault()
      const dist = touchDist(e.touches)
      const c = touchCenter(e.touches)
      if (twoFingerActive) {
        const dx = c.x - lastTouchX
        const dy = c.y - lastTouchY
        const centerMove = Math.hypot(dx, dy)
        const pinchDelta = lastPinchDist - dist
        if (centerMove > 0.2) {
          onTumblePixels(-dx, -dy)
        } else if (Math.abs(pinchDelta) > 4) {
          onDollyPixels(pinchDelta * 2.5)
        }
      }
      lastPinchDist = dist
      lastTouchX = c.x
      lastTouchY = c.y
      twoFingerActive = true
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) twoFingerActive = false
    }

    domElement.addEventListener('contextmenu', onContextMenu)
    domElement.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    domElement.addEventListener('wheel', onWheel, { passive: false })
    domElement.addEventListener('touchstart', onTouchStart, { passive: true })
    domElement.addEventListener('touchmove', onTouchMove, { passive: false })
    domElement.addEventListener('touchend', onTouchEnd)
    domElement.addEventListener('touchcancel', onTouchEnd)

    return () => {
      domElement.removeEventListener('contextmenu', onContextMenu)
      domElement.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      domElement.removeEventListener('wheel', onWheel)
      domElement.removeEventListener('touchstart', onTouchStart)
      domElement.removeEventListener('touchmove', onTouchMove)
      domElement.removeEventListener('touchend', onTouchEnd)
      domElement.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [domElement, onDollyPixels, onTumblePixels])
}
