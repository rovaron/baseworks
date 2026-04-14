import { getTranslations } from "next-intl/server";
import { SkipToContent } from "@baseworks/ui/components/skip-link";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("common");
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SkipToContent label={t("skipToContent")} />
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
    </div>
  );
}
