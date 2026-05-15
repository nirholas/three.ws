"use client";

import { useState } from "react";

interface PaywallModalProps {
  open: boolean;
  reason: string;
  onClose: () => void;
}

export function PaywallModal({ open, reason, onClose }: PaywallModalProps) {
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const upgrade = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      if (res.status === 401) {
        window.location.href = "/login?next=/play";
        return;
      }
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative max-w-sm rounded-3xl border border-white/15 bg-ink p-8">
        <p className="font-display text-2xl tracking-widest text-neon">PRO ONLY</p>
        <h2 className="mt-2 font-display text-4xl leading-none">upgrade.</h2>
        <p className="mt-4 text-sm text-paper/70">{reason}</p>
        <p className="mt-4 text-sm text-paper/60">
          Pro is $9/month. 4 characters, video recording, no watermark, 4K capture.
        </p>
        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1">
            NOT NOW
          </button>
          <button onClick={upgrade} disabled={loading} className="btn-primary flex-1">
            {loading ? "…" : "UPGRADE"}
          </button>
        </div>
      </div>
    </div>
  );
}
