"use client";

import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  Separator,
  SkipToContent,
} from "@baseworks/ui";
import { useTranslations } from "next-intl";
import { TenantProvider } from "@/components/tenant-provider";
import { SidebarNav } from "@/components/sidebar-nav";
import { useFocusOnNavigate } from "@/hooks/use-focus-on-navigate";

function DashboardContent({ children }: { children: React.ReactNode }) {
  useFocusOnNavigate();
  const t = useTranslations("common");

  return (
    <SidebarProvider>
      <SkipToContent label={t("skipToContent")} />
      <SidebarNav />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 p-6 focus:outline-none">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TenantProvider>
      <DashboardContent>{children}</DashboardContent>
    </TenantProvider>
  );
}
