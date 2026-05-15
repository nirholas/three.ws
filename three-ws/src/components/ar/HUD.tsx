"use client";

import Link from "next/link";

interface HUDProps {
  coords: { x: number; y: number };
  onFlipCamera: () => void;
  facing: "user" | "environment";
  planLabel: string;
}

export function HUD({ coords, onFlipCamera, facing, planLabel }: HUDProps) {
  return (
    <header
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between p-4"
      style={{ paddingTop: "max(env(safe-area-inset-top, 16px), 16px)" }}
    >
      <div className="flex flex-col items-start gap-2">
        <div className="pill pointer-events-auto">
          <span
            className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-acid"
            style={{ boxShadow: "0 0 10px var(--acid)" }}
            aria-hidden
          />
          <span className="font-display text-xl">
            three<span className="text-cyan">.</span>ws
          </span>
        </div>
        <Link
          href="/account"
          className="pill pointer-events-auto !py-1.5 !text-sm"
          style={{ textDecoration: "none" }}
        >
          <span className="text-paper/60">PLAN</span>
          <span className={planLabel === "PRO" ? "text-neon" : "text-paper"}>{planLabel}</span>
        </Link>
      </div>

      <div className="flex flex-col items-end gap-2">
        <button
          onClick={onFlipCamera}
          aria-label={`Switch to ${facing === "environment" ? "front" : "rear"} camera`}
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-ink/55 text-paper backdrop-blur-md transition-transform active:scale-90"
          style={{
            boxShadow:
              "0 0 0 1px rgba(255,255,255,.08), 0 8px 30px rgba(0,0,0,.45)",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3 7h3l2-2h8l2 2h3v12H3z" />
            <path d="M9 13a3 3 0 0 1 5-2.2" />
            <path d="M15 13a3 3 0 0 1-5 2.2" />
            <path d="M14 9l1-1-1-1" />
            <path d="M10 17l-1 1 1 1" />
          </svg>
        </button>
        <div className="pill !text-base font-mono tabular-nums">
          x:{String(Math.round(coords.x)).padStart(3, "0")} y:
          {String(Math.round(coords.y)).padStart(3, "0")}
        </div>
      </div>
    </header>
  );
}
