"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState<null | "google" | "email">(null);
  const [sent, setSent] = useState(false);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading("email");
    try {
      await signIn("resend", { email, callbackUrl: "/play", redirect: false });
      setSent(true);
    } finally {
      setLoading(null);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6">
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 30%, rgba(255,42,135,.18), transparent 60%), #0b0b10",
        }}
      />
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-ink/60 p-8 backdrop-blur-md">
        <Link href="/" className="font-display text-2xl tracking-wide">
          three<span className="text-cyan">.</span>ws
        </Link>
        <h1 className="mt-6 font-display text-4xl leading-none">log in.</h1>
        <p className="mt-2 text-sm text-paper/60">access the demo and manage your account.</p>

        <button
          type="button"
          onClick={() => {
            setLoading("google");
            signIn("google", { callbackUrl: "/play" });
          }}
          disabled={loading !== null}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-full bg-paper px-5 py-3 font-display text-lg tracking-widest text-ink transition-transform active:translate-y-0.5 disabled:opacity-60"
        >
          <GoogleIcon className="h-5 w-5" />
          {loading === "google" ? "OPENING…" : "CONTINUE WITH GOOGLE"}
        </button>

        <div className="my-6 flex items-center gap-3 text-xs text-paper/40">
          <div className="h-px flex-1 bg-white/10" />
          OR
          <div className="h-px flex-1 bg-white/10" />
        </div>

        {sent ? (
          <p className="rounded-xl border border-acid/40 bg-acid/10 px-4 py-3 text-sm text-acid">
            check your email. we sent you a magic link.
          </p>
        ) : (
          <form onSubmit={handleEmail} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              className="w-full rounded-full border border-white/15 bg-black/40 px-5 py-3 text-paper placeholder:text-paper/30 focus:border-cyan/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading !== null || !email}
              className="btn-ghost w-full disabled:opacity-50"
            >
              {loading === "email" ? "SENDING…" : "EMAIL ME A LINK"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#EA4335"
        d="M12 11v3.2h4.5c-.2 1.2-1.4 3.5-4.5 3.5-2.7 0-4.9-2.2-4.9-5s2.2-5 4.9-5c1.5 0 2.6.7 3.2 1.2l2.2-2.1C16 5.4 14.2 4.5 12 4.5 7.9 4.5 4.5 7.9 4.5 12s3.4 7.5 7.5 7.5c4.3 0 7.2-3 7.2-7.3 0-.5-.1-.9-.1-1.2H12z"
      />
    </svg>
  );
}
