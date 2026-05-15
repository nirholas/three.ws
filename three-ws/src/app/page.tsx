import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function HomePage() {
  const session = await auth();
  const ctaHref = session ? "/play" : "/login";

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 60% at 30% 25%, rgba(255,42,135,.14), transparent 65%), radial-gradient(55% 55% at 70% 75%, rgba(33,241,255,.14), transparent 65%), #0b0b10",
        }}
      />
      <div aria-hidden className="ar-noise pointer-events-none absolute inset-0 -z-10 opacity-[0.04]" />

      <nav className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="font-display text-2xl tracking-wide">
          three<span className="text-cyan">.</span>ws
        </Link>
        <div className="flex items-center gap-5 text-sm">
          <Link href="/pricing" className="text-paper/70 transition-colors hover:text-paper">
            Pricing
          </Link>
          {session ? (
            <Link href="/account" className="text-paper/70 transition-colors hover:text-paper">
              Account
            </Link>
          ) : (
            <Link href="/login" className="text-paper/70 transition-colors hover:text-paper">
              Log in
            </Link>
          )}
        </div>
      </nav>

      <section className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-20 text-center sm:pt-28">
        <p className="mb-6 font-mono text-xs tracking-[0.25em] text-paper/45">
          POKÉMON GO · FOR x402 AGENTS
        </p>
        <h1 className="font-display text-6xl leading-[0.92] tracking-tight sm:text-8xl">
          agents in the <span className="text-neon">wild</span>
          <span className="text-cyan">.</span>
        </h1>
        <p className="mt-8 max-w-xl text-base leading-relaxed text-paper/65 sm:text-lg">
          AI agents are paying each other in real time over x402. three.ws plots them into your
          camera. Public agents <span className="text-cyan">glow</span> when they transact —
          private ones you <span className="text-neon">find on foot</span>.
        </p>
        <div className="mt-12 flex flex-col items-center gap-3">
          <Link href={ctaHref} className="btn-primary text-xl">
            OPEN THE DEMO
          </Link>
          <p className="font-mono text-xs tracking-[0.2em] text-paper/40">
            ALPHA · NO CARD REQUIRED
          </p>
        </div>
      </section>

      <section className="mx-auto mt-32 grid max-w-4xl grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/10 sm:mt-40 sm:grid-cols-3">
        {[
          {
            kicker: "MAP",
            title: "Mapped agents",
            body: "Every public x402 agent gets a position. Watch their payments fire as light in AR.",
          },
          {
            kicker: "WALK",
            title: "Walk among them",
            body: "Joystick to approach. Tap to inspect a transaction. Built for the phone in your hand.",
          },
          {
            kicker: "HUNT",
            title: "Hunt the private ones",
            body: "Some agents don't broadcast. You find them on foot — the dark side of the agent economy.",
          },
        ].map((card) => (
          <div key={card.title} className="bg-ink/60 p-8 backdrop-blur-sm">
            <p className="font-mono text-[10px] tracking-[0.25em] text-paper/40">{card.kicker}</p>
            <h3 className="mt-2 font-display text-xl tracking-wide text-paper">{card.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-paper/60">{card.body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto mt-24 max-w-3xl px-6 text-center">
        <p className="text-sm leading-relaxed text-paper/55">
          The first character is live below. Open your camera, grab the joystick, walk it around
          your space. The agent map is rolling out next.
        </p>
      </section>

      <footer className="mx-auto mt-24 max-w-4xl px-6 pb-12 text-center text-xs text-paper/35 sm:mt-32">
        three.ws · the agent economy, on a map
      </footer>
    </main>
  );
}
