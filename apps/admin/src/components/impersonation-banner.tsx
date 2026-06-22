import { Button } from "@baseworks/ui";
import { useTranslation } from "react-i18next";
import { auth } from "@/lib/api";

/**
 * Shown at the top of the admin shell whenever the current session is an
 * impersonation (better-auth sets `session.impersonatedBy` to the operator's
 * user id). Provides a control to stop impersonating and return to the
 * operator session via the admin plugin's `stopImpersonating` action.
 */
export function ImpersonationBanner() {
  const { t } = useTranslation("admin");
  const session = auth.useSession();
  const impersonating = session.data?.session?.impersonatedBy;
  if (!impersonating) return null;
  return (
    <div className="bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-between text-sm">
      <span>{t("impersonation.active")}</span>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          await auth.admin.stopImpersonating();
          window.location.reload();
        }}
      >
        {t("impersonation.stop")}
      </Button>
    </div>
  );
}
