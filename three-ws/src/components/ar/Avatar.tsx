"use client";

import { forwardRef } from "react";

export type AvatarVariant = "rosie" | "void" | "moss" | "sun";

const PALETTES: Record<
  AvatarVariant,
  { body: [string, string, string]; trim: string; cheek: string; legDark: string; antenna: string }
> = {
  rosie: {
    body: ["#ffffff", "#ffd1e6", "#ff2a87"],
    trim: "#7a0a3c",
    cheek: "#ff6aa6",
    legDark: "#52082a",
    antenna: "#21f1ff",
  },
  void: {
    body: ["#9aa0ff", "#4a4a8a", "#0e0e2a"],
    trim: "#000019",
    cheek: "#7a7aff",
    legDark: "#020210",
    antenna: "#d9ff3c",
  },
  moss: {
    body: ["#f6ffe0", "#aedb8a", "#3a6b1a"],
    trim: "#1e3a0a",
    cheek: "#6fb04a",
    legDark: "#142706",
    antenna: "#ff8e3c",
  },
  sun: {
    body: ["#fff8d6", "#ffd86b", "#e88a00"],
    trim: "#6b3a00",
    cheek: "#ffb84d",
    legDark: "#4a2700",
    antenna: "#ff2a87",
  },
};

interface AvatarProps {
  variant: AvatarVariant;
}

/**
 * Side-view creature. Legs/arm have stable class names (.leg-front, .leg-back, .arm)
 * so the parent can drive walking animations via CSS class toggles.
 */
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { variant },
  ref,
) {
  const p = PALETTES[variant];
  const gid = `g-${variant}`; // unique gradient ids per variant
  return (
    <div
      ref={ref}
      id="avatar"
      className="pointer-events-none absolute left-0 top-0 z-10"
      style={{
        width: 120,
        height: 160,
        transformOrigin: "50% 100%",
        willChange: "transform",
        filter: "drop-shadow(0 8px 6px rgba(0,0,0,.35))",
      }}
    >
      <div
        className="ar-shadow pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{ width: 90, height: 18, bottom: -2, borderRadius: "50%" }}
        data-shadow
      />
      <div
        data-body-wrap
        className="absolute left-0 right-0 flex justify-center"
        style={{ bottom: 14, transformOrigin: "50% 100%" }}
      >
        <div data-dir style={{ transformOrigin: "50% 100%", transition: "transform 180ms ease" }}>
          <svg viewBox="0 0 120 160" width="120" height="160" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id={`${gid}-body`} cx="35%" cy="30%" r="80%">
                <stop offset="0%" stopColor={p.body[0]} />
                <stop offset="35%" stopColor={p.body[1]} />
                <stop offset="100%" stopColor={p.body[2]} />
              </radialGradient>
              <radialGradient id={`${gid}-cheek`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={p.cheek} stopOpacity="0.85" />
                <stop offset="100%" stopColor={p.cheek} stopOpacity="0" />
              </radialGradient>
              <linearGradient id={`${gid}-antenna`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.antenna} />
                <stop offset="100%" stopColor={p.trim} />
              </linearGradient>
              <linearGradient id={`${gid}-leg`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.body[2]} />
                <stop offset="100%" stopColor={p.legDark} />
              </linearGradient>
              <filter id={`${gid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.5" />
              </filter>
            </defs>

            {/* back leg */}
            <g className="leg-back svg-pivot">
              <rect x="52" y="108" width="10" height="32" rx="5" fill={p.legDark} />
              <ellipse cx="57" cy="142" rx="11" ry="4" fill={p.trim} />
            </g>

            {/* back arm */}
            <g className="arm svg-pivot" style={{ animationDirection: "reverse" }}>
              <rect x="50" y="76" width="8" height="22" rx="4" fill={p.body[2]} opacity="0.7" />
            </g>

            {/* antenna */}
            <path
              d="M70 42 Q 76 22 82 14"
              stroke={`url(#${gid}-antenna)`}
              strokeWidth="3.5"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="82" cy="14" r="7" fill={p.antenna} filter={`url(#${gid}-glow)`} opacity="0.85" />
            <circle cx="82" cy="14" r="4" fill="#ffffff" />

            {/* body */}
            <ellipse
              cx="60"
              cy="74"
              rx="34"
              ry="38"
              fill={`url(#${gid}-body)`}
              stroke={p.trim}
              strokeWidth="1.6"
            />
            <ellipse cx="52" cy="62" rx="14" ry="18" fill="#ffffff" opacity="0.25" />

            {/* eye */}
            <ellipse cx="78" cy="66" rx="7.5" ry="9.5" fill="#1a0014" />
            <circle cx="81" cy="62" r="3" fill="#ffffff" />
            <circle cx="76" cy="70" r="1.5" fill="#ffffff" opacity="0.7" />

            <path
              d="M71 54 Q 78 50 86 54"
              stroke="#1a0014"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              opacity="0.6"
            />

            <ellipse cx="72" cy="82" rx="7" ry="4" fill={`url(#${gid}-cheek)`} />
            <path
              d="M80 80 Q 86 86 90 82"
              stroke={p.trim}
              strokeWidth="2.2"
              fill="none"
              strokeLinecap="round"
            />

            {/* front arm */}
            <g className="arm svg-pivot">
              <rect x="62" y="76" width="8" height="22" rx="4" fill={p.body[2]} />
              <ellipse cx="66" cy="100" rx="6" ry="4" fill={p.trim} />
            </g>

            {/* front leg */}
            <g className="leg-front svg-pivot">
              <rect x="64" y="108" width="10" height="32" rx="5" fill={`url(#${gid}-leg)`} />
              <ellipse cx="69" cy="142" rx="12" ry="4.5" fill={p.legDark} />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
});
