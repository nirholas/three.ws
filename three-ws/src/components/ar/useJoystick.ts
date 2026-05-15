"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface JoystickVector {
  /** -1 (left) → 1 (right) */
  dx: number;
  /** -1 (up) → 1 (down) */
  dy: number;
}

/**
 * Pointer-driven joystick. Returns a normalized vector and a ref to attach
 * to the joystick base + knob elements.
 *
 * The knob is clamped to a radius (32% of the base width) and the vector is
 * read on every animation frame via the `getVector` callback to avoid
 * re-renders. Use `useJoystickVector` consumer in your loop, NOT React state.
 */
export function useJoystick() {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const vectorRef = useRef<JoystickVector>({ dx: 0, dy: 0 });
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);

  const setKnobPos = (dx: number, dy: number) => {
    if (!knobRef.current) return;
    knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!baseRef.current) return;
    activeRef.current = true;
    setActive(true);
    knobRef.current?.classList.add("is-dragging");
    baseRef.current.setPointerCapture(e.pointerId);
    handleMove(e.clientX, e.clientY);
  }, []);

  const handleMove = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = rect.width * 0.32;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    setKnobPos(dx, dy);
    vectorRef.current.dx = dx / max;
    vectorRef.current.dy = dy / max;
  };

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!activeRef.current) return;
    handleMove(e.clientX, e.clientY);
  }, []);

  const release = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    vectorRef.current.dx = 0;
    vectorRef.current.dy = 0;
    setKnobPos(0, 0);
    knobRef.current?.classList.remove("is-dragging");
  }, []);

  // Keyboard fallback for desktop
  useEffect(() => {
    const keys: Record<string, boolean> = {};
    const sync = () => {
      let dx = 0;
      let dy = 0;
      if (keys["arrowleft"] || keys["a"]) dx -= 1;
      if (keys["arrowright"] || keys["d"]) dx += 1;
      if (keys["arrowup"] || keys["w"]) dy -= 1;
      if (keys["arrowdown"] || keys["s"]) dy += 1;
      if (dx === 0 && dy === 0) {
        if (!activeRef.current) {
          vectorRef.current.dx = 0;
          vectorRef.current.dy = 0;
          setKnobPos(0, 0);
        }
        return;
      }
      const m = Math.hypot(dx, dy);
      vectorRef.current.dx = dx / m;
      vectorRef.current.dy = dy / m;
      if (baseRef.current) {
        const max = baseRef.current.getBoundingClientRect().width * 0.32;
        setKnobPos(vectorRef.current.dx * max, vectorRef.current.dy * max);
      }
    };

    const down = (e: KeyboardEvent) => {
      keys[e.key.toLowerCase()] = true;
      sync();
    };
    const up = (e: KeyboardEvent) => {
      keys[e.key.toLowerCase()] = false;
      sync();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return {
    baseRef,
    knobRef,
    vectorRef,
    active,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: release,
    },
  };
}
