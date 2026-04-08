"use client";

import { SidebarProvider, SidebarInset } from "@baseworks/ui/components/sidebar";
import { TenantProvider } from "@/components/tenant-provider";
import { SidebarNav } from "@/components/sidebar-nav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TenantProvider>
      <SidebarProvider>
        <SidebarNav />
        <SidebarInset>
          <div className="mx-auto max-w-4xl p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TenantProvider>
  );
}
