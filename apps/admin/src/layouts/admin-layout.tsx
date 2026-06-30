import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Separator,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SkipToContent,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useSidebar,
} from "@baseworks/ui";
import {
  Activity,
  Building2,
  ChevronUp,
  CreditCard,
  KeyRound,
  ListTodo,
  LogOut,
  Users,
  Webhook,
} from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { useFocusOnNavigate } from "@/hooks/use-focus-on-navigate";
import { auth } from "@/lib/api";
import { AuthGuard } from "./auth-guard";

const navItems = [
  { titleKey: "nav.tenants", icon: Building2, href: "/tenants" },
  { titleKey: "nav.roles", icon: KeyRound, href: "/roles" },
  { titleKey: "nav.users", icon: Users, href: "/users" },
  { titleKey: "nav.webhooks", icon: Webhook, href: "/webhooks" },
  { titleKey: "nav.billing", icon: CreditCard, href: "/billing" },
  { titleKey: "nav.system", icon: Activity, href: "/system" },
  { titleKey: "nav.jobs", icon: ListTodo, href: "/jobs" },
];

function NavigationAutoClose() {
  const location = useLocation();
  const { setOpenMobile } = useSidebar();

  React.useEffect(() => {
    setOpenMobile(false);
  }, [location.pathname, setOpenMobile]);

  return null;
}

function AdminLayoutContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = auth.useSession();
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  useFocusOnNavigate();

  const userName = session.data?.user?.name || t("title");
  const userEmail = session.data?.user?.email || "";
  const initials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex min-h-svh flex-col">
      <SidebarProvider>
        <SkipToContent label={tc("skipToContent")} />
        <NavigationAutoClose />
        <TooltipProvider>
          <nav aria-label="Main navigation">
            <Sidebar collapsible="icon">
              <SidebarHeader className="p-4">
                <span className="text-lg font-semibold">{t("title")}</span>
              </SidebarHeader>
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {navItems.map((item) => {
                        const isActive =
                          location.pathname === item.href ||
                          location.pathname.startsWith(item.href + "/");
                        const title = t(item.titleKey);

                        return (
                          <SidebarMenuItem key={item.href}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <SidebarMenuButton asChild isActive={isActive} className="min-h-11">
                                  <a
                                    href={item.href}
                                    aria-label={title}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      navigate(item.href);
                                    }}
                                  >
                                    <item.icon className="h-4 w-4" />
                                    <span>{title}</span>
                                  </a>
                                </SidebarMenuButton>
                              </TooltipTrigger>
                              <TooltipContent side="right">{title}</TooltipContent>
                            </Tooltip>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
              <SidebarFooter>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuButton className="min-h-11">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                          </Avatar>
                          <span className="truncate">{userName}</span>
                          <ChevronUp className="ml-auto h-4 w-4" />
                        </SidebarMenuButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="top" align="start" className="w-56">
                        <div className="px-2 py-1.5">
                          <p className="text-sm font-medium">{userName}</p>
                          <p className="text-xs text-muted-foreground">{userEmail}</p>
                        </div>
                        <DropdownMenuItem
                          onClick={async () => {
                            await auth.signOut();
                            navigate("/login");
                          }}
                        >
                          <LogOut className="mr-2 h-4 w-4" />
                          {tc("signOut")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarFooter>
            </Sidebar>
          </nav>
          <SidebarInset>
            <header className="flex h-14 items-center gap-2 border-b px-4">
              <SidebarTrigger />
              <Separator orientation="vertical" className="h-6" />
            </header>
            <main id="main-content" tabIndex={-1} className="flex-1 p-6 focus:outline-none">
              <Outlet />
            </main>
          </SidebarInset>
        </TooltipProvider>
      </SidebarProvider>
    </div>
  );
}

export function Component() {
  return (
    // ImpersonationBanner sits ABOVE AuthGuard: an impersonation session carries
    // the TARGET user's (non-admin) role, so AuthGuard would otherwise show
    // "Access Denied" and hide the stop-impersonating control — stranding the
    // operator. Rendered here, the banner stays reachable (it returns null when
    // not impersonating, so normal admin sessions are visually unchanged).
    <>
      <ImpersonationBanner />
      <AuthGuard>
        <AdminLayoutContent />
      </AuthGuard>
    </>
  );
}
