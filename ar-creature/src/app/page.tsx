import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function HomePage() {
  const session = await auth();
  const ctaHref = session ? "/play" : "/login";

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* atmospheric background */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 60% at 30% 30%, rgba(255,42,135,.22), transparent 60%), radial-gradient(60% 60% at 70% 70%, rgba(33,241,255,.22), transparent 60%), #0b0b10",
        }}
      />
      <div aria-hidden className="ar-noise pointer-events-none absolute inset-0 -z-10 opacity-[0.06]" />

      <nav className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="font-display text-3xl tracking-wide">
          POCKET <span className="text-neon">◆</span> <span className="text-cyan">AR</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/pricing" className="btn-ghost text-sm sm:text-lg">
            PRICING
          </Link>
          {session ? (
            <Link href="/account" className="btn-ghost text-sm sm:text-lg">
              ACCOUNT
            </Link>
          ) : (
            <Link href="/login" className="btn-ghost text-sm sm:text-lg">
              LOG IN
            </Link>
          )}
        </div>
      </nav>

      <section className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-16 text-center sm:pt-24">
        <p className="mb-6 font-display text-xl tracking-[0.3em] text-acid drop-shadow-[0_0_12px_rgba(217,255,60,0.4)]">
          ▷ ▷ ▷ NEW &amp; LIVE ◁ ◁ ◁
        </p>
        <h1 className="font-display text-6xl leading-none tracking-tight sm:text-8xl">
          a creature
          <br />
          lives in your
          <br />
          <span className="text-neon">camera.</span>
        </h1>
        <p className="mt-8 max-w-md text-base leading-relaxed text-paper/70 sm:text-lg">
          Open the camera. A tiny creature appears, standing in your room. Grab the joystick and walk
          it across the floor, into the kitchen, anywhere. It scales with depth, casts a shadow, and
          looks like it&apos;s really there.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3">
          <Link href={ctaHref} className="btn-primary text-2xl">
            START PLAYING
          </Link>
          <p className="font-display text-sm tracking-widest text-paper/40">
            FREE TIER — NO CARD REQUIRED
          </p>
        </div>
      </section>

      <section className="mx-auto mt-32 grid max-w-4xl grid-cols-1 gap-6 px-6 pb-24 sm:grid-cols-3">
        {[
          { title: "REAL CAMERA", body: "Live video feed from your phone or laptop. The creature lives on top of it." },
          { title: "DEPTH ILLUSION", body: "Walk it up the screen and it shrinks. Walk it down and it grows. Reads as a tiny being in your space." },
          { title: "JOYSTICK", body: "Real analog joystick on screen. Drag, push, run. Side-view walking sprite with leg animation." },
        ].map((card) => (
          <div
            key={card.title}
            className="rounded-2xl border border-white/10 bg-ink/40 p-6 backdrop-blur-sm"
          >
            <h3 className="font-display text-2xl tracking-widest text-neon">{card.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-paper/70">{card.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
