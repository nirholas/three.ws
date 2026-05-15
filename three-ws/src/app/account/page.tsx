import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { getUserPlan } from "@/lib/subscription";
import { ManageBillingButton } from "@/components/ManageBillingButton";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/account");
  }
  const plan = await getUserPlan(session.user.id);
  const sp = await searchParams;

  return (
    <main className="relative min-h-screen px-6 py-12">
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ background: "radial-gradient(60% 60% at 50% 30%, rgba(33,241,255,.15), transparent 60%), #0b0b10" }}
      />
      <Link href="/" className="font-display text-2xl tracking-wide">
        ← three<span className="text-cyan">.</span>ws
      </Link>

      <div className="mx-auto mt-16 max-w-xl">
        {sp.checkout === "success" && (
          <div className="mb-8 rounded-2xl border border-acid/40 bg-acid/10 px-5 py-4 text-acid">
            You&apos;re on Pro. The webhook may take a few seconds to confirm.
          </div>
        )}

        <h1 className="font-display text-5xl leading-none">account.</h1>
        <p className="mt-2 text-paper/60">{session.user.email}</p>

        <div className="mt-10 rounded-3xl border border-white/10 bg-ink/40 p-6 backdrop-blur-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-3xl tracking-wide">PLAN</h2>
            <span
              className={`rounded-full px-3 py-1 font-display text-sm tracking-widest ${
                plan.planId === "pro" ? "bg-neon/15 text-neon" : "bg-white/5 text-paper/70"
              }`}
            >
              {plan.planId.toUpperCase()}
            </span>
          </div>

          {plan.planId === "pro" ? (
            <>
              <p className="mt-4 text-sm text-paper/70">
                Status: <span className="text-paper">{plan.status}</span>
              </p>
              {plan.currentPeriodEnd && (
                <p className="text-sm text-paper/70">
                  {plan.cancelAtPeriodEnd ? "Ends" : "Renews"} on{" "}
                  <span className="text-paper">
                    {plan.currentPeriodEnd.toLocaleDateString()}
                  </span>
                </p>
              )}
              <div className="mt-6">
                <ManageBillingButton />
              </div>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm text-paper/70">
                You&apos;re on the free plan. Upgrade for more characters, video recording, and no
                watermark.
              </p>
              <Link href="/pricing" className="btn-primary mt-6">
                UPGRADE TO PRO
              </Link>
            </>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <Link href="/play" className="btn-ghost">
            ← BACK TO PLAY
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="btn-ghost">
              SIGN OUT
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
