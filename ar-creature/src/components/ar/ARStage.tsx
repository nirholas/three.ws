"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraFeed, type CameraHandle } from "./CameraFeed";
import { Joystick } from "./Joystick";
import { Avatar, type AvatarVariant } from "./Avatar";
import { AvatarSelector } from "./AvatarSelector";
import { HUD } from "./HUD";
import { PaywallModal } from "./PaywallModal";
import { useJoystick } from "./useJoystick";
import type { PlanEntitlements } from "@/lib/plans";

const AVATAR_W = 120;
const AVATAR_H = 160;
const BASE_SPEED = 360;
const DEAD = 0.08;
const ALL_VARIANTS: AvatarVariant[] = ["rosie", "void", "moss", "sun"];

interface ARStageProps {
  entitlements: PlanEntitlements;
  planLabel: string;
}

export function ARStage({ entitlements, planLabel }: ARStageProps) {
  // Camera
  const cameraRef = useRef<CameraHandle>(null);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Avatar
  const avatarRef = useRef<HTMLDivElement | null>(null);
  const [variant, setVariant] = useState<AvatarVariant>("rosie");
  const posRef = useRef({
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 400,
    y: typeof window !== "undefined" ? window.innerHeight * 0.78 : 500,
  });
  const facingDirRef = useRef<1 | -1>(1);
  const [coords, setCoords] = useState({ x: posRef.current.x, y: posRef.current.y });

  // Joystick
  const { baseRef, knobRef, vectorRef, handlers } = useJoystick();

  // Paywall
  const [paywall, setPaywall] = useState<{ open: boolean; reason: string }>({
    open: false,
    reason: "",
  });
  const [toast, setToast] = useState<string | null>(null);

  // ---------- depth scaling ----------
  const depthFromY = useCallback((y: number) => {
    const h = window.innerHeight;
    const top = h * 0.25;
    const bot = h * 0.95;
    const t = Math.max(0, Math.min(1, (y - top) / (bot - top)));
    return 0.45 + t * 0.85;
  }, []);

  // ---------- main loop ----------
  useEffect(() => {
    let raf = 0;
    let lastT = performance.now();
    let coordTick = 0;

    const tick = (t: number) => {
      const dt = Math.min(0.04, (t - lastT) / 1000);
      lastT = t;

      let { dx, dy } = vectorRef.current;
      const mag = Math.hypot(dx, dy);
      const moving = mag >= DEAD;
      if (!moving) {
        dx = 0;
        dy = 0;
      }

      const av = avatarRef.current;
      if (!av) {
        raf = requestAnimationFrame(tick);
        return;
      }

      if (moving) {
        const s = depthFromY(posRef.current.y);
        const speed = BASE_SPEED * (0.5 + s * 0.6);
        posRef.current.x += dx * speed * dt;
        posRef.current.y += dy * speed * dt;

        // clamp
        const halfW = (AVATAR_W * depthFromY(posRef.current.y)) / 2;
        posRef.current.x = Math.max(halfW, Math.min(window.innerWidth - halfW, posRef.current.x));
        posRef.current.y = Math.max(
          window.innerHeight * 0.18,
          Math.min(window.innerHeight - 8, posRef.current.y),
        );

        // facing direction
        if (dx < -0.12) facingDirRef.current = -1;
        else if (dx > 0.12) facingDirRef.current = 1;
      }

      // apply transform: position + depth scale (origin at feet)
      const s = depthFromY(posRef.current.y);
      av.style.transform =
        `translate(${posRef.current.x - AVATAR_W / 2}px, ${posRef.current.y - AVATAR_H}px) ` +
        `scale(${s})`;

      // movement class (drives CSS leg/arm/stride animations)
      av.classList.toggle("ar-moving", moving);
      // facing direction on .dir element
      const dirEl = av.querySelector("[data-dir]") as HTMLElement | null;
      if (dirEl) {
        dirEl.style.transform = `scaleX(${facingDirRef.current})`;
      }
      // shadow opacity scales with depth
      const sh = av.querySelector("[data-shadow]") as HTMLElement | null;
      if (sh) sh.style.opacity = (0.45 + s * 0.35).toFixed(2);

      // throttle coord state updates (HUD) to ~15fps to avoid extra renders
      coordTick++;
      if (coordTick % 4 === 0) {
        setCoords({ x: posRef.current.x, y: posRef.current.y });
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [depthFromY, vectorRef]);

  // keep avatar inside on resize
  useEffect(() => {
    const onResize = () => {
      posRef.current.x = Math.min(posRef.current.x, window.innerWidth - 60);
      posRef.current.y = Math.min(posRef.current.y, window.innerHeight - 8);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ---------- handlers ----------
  const flipCamera = async () => {
    const next = facing === "environment" ? "user" : "environment";
    await cameraRef.current?.setFacing(next);
    setFacing(next);
    showToast(next === "user" ? "FRONT CAM" : "REAR CAM");
  };

  const selectAvatar = (v: AvatarVariant) => {
    setVariant(v);
    showToast(`HELLO, ${v.toUpperCase()}`);
  };

  const onLockedAvatar = () => {
    setPaywall({
      open: true,
      reason: "Free includes 1 creature. Pro unlocks the full cast.",
    });
  };

  // ---------- capture (REAL — composites video frame + avatar onto canvas) ----------
  const capturePhoto = async () => {
    if (!entitlements.canCapturePhotos) {
      setPaywall({ open: true, reason: "Photo capture is locked on this plan." });
      return;
    }
    const video = cameraRef.current?.videoEl;
    const av = avatarRef.current;
    if (!video || !av || cameraError) return;

    const maxEdge = entitlements.maxCaptureRes;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // scale to match screen aspect (cover behaviour), capped by maxCaptureRes
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    const scale = Math.min(maxEdge / Math.max(ww, wh), 2);
    const outW = Math.round(ww * scale);
    const outH = Math.round(wh * scale);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 1. draw video with object-cover behaviour
    const videoAspect = vw / vh;
    const outAspect = outW / outH;
    let drawW: number, drawH: number, drawX: number, drawY: number;
    if (videoAspect > outAspect) {
      drawH = outH;
      drawW = outH * videoAspect;
      drawX = (outW - drawW) / 2;
      drawY = 0;
    } else {
      drawW = outW;
      drawH = outW / videoAspect;
      drawX = 0;
      drawY = (outH - drawH) / 2;
    }
    if (facing === "user") {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -drawX - drawW, drawY, drawW, drawH);
      ctx.restore();
    } else {
      ctx.drawImage(video, drawX, drawY, drawW, drawH);
    }

    // 2. rasterize avatar SVG onto an Image and composite
    const svgEl = av.querySelector("svg");
    if (svgEl) {
      const xml = new XMLSerializer().serializeToString(svgEl);
      const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      try {
        const img = await loadImage(svgUrl);
        const s = depthFromY(posRef.current.y);
        const aW = AVATAR_W * s * scale;
        const aH = AVATAR_H * s * scale;
        const ax = posRef.current.x * scale - aW / 2;
        const ay = posRef.current.y * scale - aH;

        // shadow
        ctx.save();
        ctx.globalAlpha = 0.45 + s * 0.35;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.ellipse(
          posRef.current.x * scale,
          posRef.current.y * scale,
          45 * s * scale,
          9 * s * scale,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.restore();

        // avatar (flip horizontally if facing left)
        ctx.save();
        if (facingDirRef.current === -1) {
          ctx.translate(ax + aW / 2, 0);
          ctx.scale(-1, 1);
          ctx.translate(-(ax + aW / 2), 0);
        }
        ctx.drawImage(img, ax, ay, aW, aH);
        ctx.restore();
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
    }

    // 3. watermark (free tier only)
    if (entitlements.watermark) {
      ctx.save();
      ctx.font = `${Math.round(outW * 0.025)}px "Space Mono", monospace`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.textBaseline = "bottom";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 8;
      ctx.fillText("◆ pocket-ar.app", outW * 0.025, outH - outW * 0.025);
      ctx.restore();
    }

    // 4. download
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pocket-ar-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, "image/png");

    showToast("SAVED");
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1200);
  };

  return (
    <main className="fixed inset-0 overflow-hidden bg-black">
      <CameraFeed
        ref={cameraRef}
        initialFacing="environment"
        onError={(e) => setCameraError(e.name === "NotAllowedError" ? "Camera permission denied. Allow camera access in your browser." : e.message)}
      />

      {/* subtle vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 50%, transparent 70%, rgba(0,0,0,.35) 100%)",
        }}
      />

      <Avatar ref={avatarRef} variant={variant} />

      <HUD
        coords={coords}
        onFlipCamera={flipCamera}
        facing={facing}
        planLabel={planLabel}
      />

      <AvatarSelector
        variants={ALL_VARIANTS}
        active={variant}
        unlockedCount={entitlements.avatarCount}
        onSelect={selectAvatar}
        onLockedTap={onLockedAvatar}
      />

      <Joystick baseRef={baseRef} knobRef={knobRef} handlers={handlers} />

      <button
        onClick={capturePhoto}
        aria-label="Capture photo"
        className="fixed right-7 z-30 flex h-20 w-20 items-center justify-center rounded-full font-display text-xl text-ink transition-transform active:scale-90"
        style={{
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)",
          background:
            "radial-gradient(circle at 35% 30%, #fff, #d9ff3c 55%, #6c8a00 100%)",
          border: "1px solid rgba(255,255,255,.4)",
          boxShadow:
            "0 10px 24px rgba(217,255,60,.4), inset 0 -8px 14px rgba(0,0,0,.25), inset 0 4px 8px rgba(255,255,255,.5)",
        }}
      >
        <span
          aria-hidden
          className="absolute inset-[-8px] rounded-full border border-dashed border-acid/60 animate-spin-slow"
        />
        SNAP
      </button>

      {cameraError && (
        <div className="fixed inset-x-0 top-24 z-40 mx-auto max-w-sm rounded-2xl border border-neon/40 bg-ink/90 p-4 text-center text-sm text-neon">
          {cameraError}
        </div>
      )}

      {toast && (
        <div
          className="pointer-events-none fixed left-1/2 z-40 -translate-x-1/2 font-display text-lg tracking-widest text-cyan"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 250px)",
            textShadow: "0 0 10px rgba(33,241,255,0.5)",
          }}
        >
          ◆ {toast} ◆
        </div>
      )}

      <PaywallModal
        open={paywall.open}
        reason={paywall.reason}
        onClose={() => setPaywall({ open: false, reason: "" })}
      />

      <style jsx global>{`
        #avatar [data-body-wrap] {
          animation: breath 2.4s ease-in-out infinite;
        }
        #avatar.ar-moving [data-body-wrap] {
          animation: stride 0.46s ease-in-out infinite;
        }
        #avatar.ar-moving .leg-front {
          animation: legFront 0.46s ease-in-out infinite;
        }
        #avatar.ar-moving .leg-back {
          animation: legBack 0.46s ease-in-out infinite;
        }
        #avatar.ar-moving .arm {
          animation: armSwing 0.46s ease-in-out infinite;
        }
      `}</style>
    </main>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
