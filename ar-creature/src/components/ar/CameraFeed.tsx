"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type CameraFacing = "user" | "environment";

export interface CameraHandle {
  /** Switch which camera is active */
  setFacing: (facing: CameraFacing) => Promise<void>;
  /** Current facing mode */
  facing: CameraFacing;
  /** Underlying video element (for canvas capture) */
  videoEl: HTMLVideoElement | null;
}

interface CameraFeedProps {
  initialFacing?: CameraFacing;
  onReady?: () => void;
  onError?: (err: Error) => void;
}

export const CameraFeed = forwardRef<CameraHandle, CameraFeedProps>(function CameraFeed(
  { initialFacing = "environment", onReady, onError },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacingState] = useState<CameraFacing>(initialFacing);

  const start = async (next: CameraFacing) => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support camera access.");
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: next },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.style.transform = next === "user" ? "scaleX(-1)" : "scaleX(1)";
        await videoRef.current.play().catch(() => {});
      }
      setFacingState(next);
      onReady?.();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      onError?.(e);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      setFacing: start,
      facing,
      videoEl: videoRef.current,
    }),
    [facing],
  );

  useEffect(() => {
    void start(initialFacing);
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="absolute inset-0 h-full w-full bg-black object-cover"
    />
  );
});
