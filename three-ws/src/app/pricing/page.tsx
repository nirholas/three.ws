"use client";

import { useState } from "react";
import Link from "next/link";
import { PLANS } from "@/lib/plans";

export default function PricingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpgrade = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      if (res.status === 401) {
        window.location.href = "/login?next=/pricing";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create checkout session");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen px-6 py-12">
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 60% at 30% 30%, rgba(255,42,135,.18), transparent 60%), radial-gradient(60% 60% at 70% 70%, rgba(33,241,255,.18), transparent 60%), #0b0b10",
        }}
      />
      <Link href="/" className="font-display text-2xl tracking-wide">
        ← three<span className="text-cyan">.</span>ws
      </Link>

      <div className="mx-auto mt-16 max-w-3xl text-center">
        <h1 className="font-display text-6xl leading-none sm:text-7xl">
          pricing<span className="text-cyan">.</span>
        </h1>
        <p className="mt-4 text-paper/60">free to roam. Pro unlocks more characters and capture.</p>
      </div>

      <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-2">
        <PlanCard
          name={PLANS.free.name}
          price={PLANS.free.price}
          features={[
            "1 character",
            "AR camera mode",
            "Photo capture (watermarked)",
            "Up to 1080p",
          ]}
          cta={
            <Link href="/play" className="btn-ghost w-full">
              START FREE
            </Link>
          }
        />
        <PlanCard
          name={PLANS.pro.name}
          price={PLANS.pro.price}
          highlight
          features={[
            "4 characters",
            "Video recording",
            "No watermark",
            "Up to 4K capture",
            "Priority support",
          ]}
          cta={
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="btn-primary w-full disabled:opacity-60"
            >
              {loading ? "REDIRECTING…" : "UPGRADE TO PRO"}
            </button>
          }
        />
      </div>

      {error && (
        <p className="mx-auto mt-6 max-w-md rounded-xl border border-neon/40 bg-neon/10 px-4 py-3 text-center text-sm text-neon">
          {error}
        </p>
      )}

      <p className="mx-auto mt-10 max-w-md text-center text-xs text-paper/40">
        Payments handled by Stripe. Cancel anytime from your account.
      </p>
    </main>
  );
}

function PlanCard({
  name,
  price,
  features,
  cta,
  highlight,
}: {
  name: string;
  price: number;
  features: string[];
  cta: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border p-8 backdrop-blur-sm ${
        highlight ? "border-neon/40 bg-neon/5" : "border-white/10 bg-ink/40"
      }`}
    >
      <p className="font-display text-2xl tracking-widest text-paper/70">{name.toUpperCase()}</p>
      <p className="mt-2 font-display text-6xl leading-none">
        ${price}
        <span className="ml-1 text-base text-paper/50">/mo</span>
      </p>
      <ul className="mt-6 space-y-2 text-sm text-paper/80">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className={highlight ? "text-neon" : "text-cyan"}>—</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8">{cta}</div>
    </div>
  );
}
