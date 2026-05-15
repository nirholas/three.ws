import { ARStage } from "@/components/ar/ARStage";
import { PLANS } from "@/lib/plans";

// DEV BYPASS: auth check removed so /play renders without sign-in.
// Restore the original `auth()`/`getUserPlan()` block before deploying.
export default async function PlayPage() {
  return (
    <ARStage
      entitlements={PLANS.free.entitlements}
      planLabel="FREE"
    />
  );
}
