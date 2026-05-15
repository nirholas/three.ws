"use client";

import type { AvatarVariant } from "./Avatar";

interface AvatarSelectorProps {
  variants: AvatarVariant[];
  active: AvatarVariant;
  unlockedCount: number;
  onSelect: (v: AvatarVariant) => void;
  onLockedTap: (v: AvatarVariant) => void;
}

const COLORS: Record<AvatarVariant, string> = {
  rosie: "linear-gradient(135deg, #ffd1e6, #ff2a87)",
  void: "linear-gradient(135deg, #9aa0ff, #0e0e2a)",
  moss: "linear-gradient(135deg, #aedb8a, #3a6b1a)",
  sun: "linear-gradient(135deg, #ffd86b, #e88a00)",
};

export function AvatarSelector({
  variants,
  active,
  unlockedCount,
  onSelect,
  onLockedTap,
}: AvatarSelectorProps) {
  return (
    <div
      className="fixed left-1/2 z-30 flex -translate-x-1/2 gap-2 rounded-full border border-white/10 bg-ink/55 p-1.5 backdrop-blur-md"
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 200px)",
        boxShadow: "0 0 0 1px rgba(255,255,255,.08), 0 8px 30px rgba(0,0,0,.45)",
      }}
    >
      {variants.map((v, i) => {
        const locked = i >= unlockedCount;
        const isActive = v === active;
        return (
          <button
            key={v}
            onClick={() => (locked ? onLockedTap(v) : onSelect(v))}
            aria-label={`Select ${v}${locked ? " (locked)" : ""}`}
            className="relative h-9 w-9 rounded-full transition-transform active:scale-90"
            style={{
              background: COLORS[v],
              border: isActive ? "2px solid var(--acid)" : "2px solid rgba(255,255,255,0.2)",
              boxShadow: isActive ? "0 0 12px rgba(217,255,60,0.6)" : "none",
              opacity: locked ? 0.45 : 1,
            }}
          >
            {locked && (
              <span
                className="absolute inset-0 flex items-center justify-center text-base text-paper"
                aria-hidden
              >
                🔒
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
