"use client";

import { useRef, useState } from "react";
import { CameraFeed, type CameraHandle } from "./CameraFeed";
import { Joystick } from "./Joystick";
import type { AvatarVariant } from "./Avatar";
import { AR3DScene, type AR3DSceneHandle } from "./AR3DScene";
import { AvatarSelector } from "./AvatarSelector";
import { HUD } from "./HUD";
import { PaywallModal } from "./PaywallModal";
import { useJoystick } from "./useJoystick";
import type { PlanEntitlements } from "@/lib/plans";

const ALL_VARIANTS: AvatarVariant[] = ["rosie", "void", "moss", "sun"];

interface ARStageProps {
  entitlements: PlanEntitlements;
  planLabel: string;
}

export function ARStage({ entitlements, planLabel }: ARStageProps) {
  // Camera feed
  const cameraRef = useRef<CameraHandle>(null);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);

  // 3D scene
  const sceneRef = useRef<AR3DSceneHandle>(null);
  const [variant, setVariant] = useState<AvatarVariant>("rosie");
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  // Joystick
  const { baseRef, knobRef, vectorRef, handlers } = useJoystick();

  // Paywall
  const [paywall, setPaywall] = useState<{ open: boolean; reason: string }>({
    open: false,
    reason: "",
  });
  const [toast, setToast] = useState<string | null>(null);

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
      reason: "Free includes 1 character. Pro unlocks the full cast.",
    });
  };

  // Composite the live video feed and the WebGL canvas into a single PNG.
  const capturePhoto = async () => {
    if (!entitlements.canCapturePhotos) {
      setPaywall({ open: true, reason: "Photo capture is locked on this plan." });
      return;
    }
    const video = cameraRef.current?.videoEl;
    const glCanvas = sceneRef.current?.glCanvas;
    if (!video || !glCanvas || cameraError) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const maxEdge = entitlements.maxCaptureRes;
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

    // 1. Draw video (object-cover behaviour to match on-screen layout)
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

    // 2. Overlay the GL canvas (already transparent — character + soft shadow only)
    ctx.drawImage(glCanvas, 0, 0, outW, outH);

    // 3. Watermark on free tier
    if (entitlements.watermark) {
      ctx.save();
      ctx.font = `${Math.round(outW * 0.025)}px "Space Mono", monospace`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.textBaseline = "bottom";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 8;
      ctx.fillText("three.ws", outW * 0.025, outH - outW * 0.025);
      ctx.restore();
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `three-ws-${Date.now()}.png`;
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
        onError={(e) =>
          setCameraError(
            e.name === "NotAllowedError"
              ? "Camera permission denied. Allow camera access in your browser."
              : e.message,
          )
        }
      />

      <AR3DScene
        ref={sceneRef}
        variant={variant}
        vectorRef={vectorRef}
        onScreenPos={(x, y) => setCoords({ x, y })}
      />

      {/* subtle vignette over both camera + 3D scene */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 50%, transparent 70%, rgba(0,0,0,.35) 100%)",
        }}
      />

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
          {toast}
        </div>
      )}

      <PaywallModal
        open={paywall.open}
        reason={paywall.reason}
        onClose={() => setPaywall({ open: false, reason: "" })}
      />
    </main>
  );
}
