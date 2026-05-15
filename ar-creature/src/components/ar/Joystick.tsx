"use client";

import type { MutableRefObject } from "react";

interface JoystickProps {
  baseRef: MutableRefObject<HTMLDivElement | null>;
  knobRef: MutableRefObject<HTMLDivElement | null>;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
  };
}

export function Joystick({ baseRef, knobRef, handlers }: JoystickProps) {
  return (
    <div
      ref={baseRef}
      {...handlers}
      className="fixed z-30 touch-none select-none"
      style={{
        left: 24,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
        width: 140,
        height: 140,
        borderRadius: "50%",
        background:
          "radial-gradient(60% 60% at 50% 50%, rgba(33,241,255,.08), rgba(33,241,255,0) 70%), rgba(11,11,16,.42)",
        backdropFilter: "blur(10px) saturate(140%)",
        WebkitBackdropFilter: "blur(10px) saturate(140%)",
        border: "1px solid rgba(255,255,255,.14)",
        boxShadow:
          "0 0 0 1px rgba(255,255,255,.08), 0 8px 30px rgba(0,0,0,.45), inset 0 0 30px rgba(33,241,255,.08)",
      }}
    >
      <span
        className="pointer-events-none absolute left-1/2 -top-6 -translate-x-1/2 font-display text-lg tracking-[0.3em] text-cyan"
        style={{ textShadow: "0 0 8px rgba(33,241,255,0.5)" }}
      >
        MOVE
      </span>
      <div
        ref={knobRef}
        className="absolute left-1/2 top-1/2 [&.is-dragging]:!transition-none"
        style={{
          width: 60,
          height: 60,
          borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle at 35% 30%, #fff, #ffb4d5 30%, #ff2a87 65%, #7a0a3c 100%)",
          border: "1px solid rgba(255,255,255,.4)",
          boxShadow:
            "0 8px 20px rgba(255,42,135,.45), inset 0 -6px 12px rgba(0,0,0,.35), inset 0 4px 8px rgba(255,255,255,.4)",
          transition: "transform 180ms cubic-bezier(.2,.8,.2,1)",
        }}
      />
    </div>
  );
}
