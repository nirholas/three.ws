import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserPlan } from "@/lib/subscription";
import { ARStage } from "@/components/ar/ARStage";

export default async function PlayPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/play");
  }
  const plan = await getUserPlan(session.user.id);

  return (
    <ARStage
      entitlements={plan.entitlements}
      planLabel={plan.planId.toUpperCase()}
    />
  );
}
