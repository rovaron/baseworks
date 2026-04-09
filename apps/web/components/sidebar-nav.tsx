"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, CreditCard, Settings, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@baseworks/ui";
import { auth } from "@/lib/api";
import { useTenant } from "./tenant-provider";
import { TenantSwitcher } from "./tenant-switcher";

const navIcons = {
  dashboard: LayoutDashboard,
  billing: CreditCard,
  settings: Settings,
};

const navHrefs = [
  { key: "dashboard", href: "/dashboard", icon: navIcons.dashboard },
  { key: "billing", href: "/dashboard/billing", icon: navIcons.billing },
  { key: "settings", href: "/dashboard/settings", icon: navIcons.settings },
];

export function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeTenant } = useTenant();
  const session = auth.useSession();
  const { setOpenMobile } = useSidebar();
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");

  // Auto-dismiss mobile Sheet on navigation.
  React.useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  const user = session.data?.user;

  const navItems = navHrefs.map((item) => ({
    ...item,
    label: t(`nav.${item.key}` as any),
  }));

  async function handleSignOut() {
    await auth.signOut();
    router.push("/login");
  }

  return (
    <nav aria-label="Main navigation">
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="text-lg font-semibold truncate group-data-[collapsible=icon]:hidden">
            {activeTenant?.name ?? "Baseworks"}
          </span>
          <SidebarTrigger className="ml-auto" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.navigation")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      className="min-h-[44px]"
                    >
                      <Link href={item.href} aria-label={item.label}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="group-data-[collapsible=icon]:hidden" />

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>{t("nav.workspace")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <TenantSwitcher />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              aria-label={t("nav.user")}
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">
                  {user?.name
                    ? user.name
                        .split(" ")
                        .map((w: string) => w[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)
                    : "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col truncate group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium">
                  {user?.name ?? t("nav.user")}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user?.email ?? ""}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              {tc("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
    </nav>
  );
}
