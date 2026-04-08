import * as React from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  Separator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Avatar,
  AvatarFallback,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useSidebar,
} from "@baseworks/ui";
import { Building2, Users, CreditCard, Activity, LogOut, ChevronUp } from "lucide-react";
import { AuthGuard } from "./auth-guard";
import { auth } from "@/lib/api";

const navItems = [
  { title: "Tenants", icon: Building2, href: "/tenants" },
  { title: "Users", icon: Users, href: "/users" },
  { title: "Billing", icon: CreditCard, href: "/billing" },
  { title: "System", icon: Activity, href: "/system" },
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

  const userName = session.data?.user?.name || "Admin";
  const userEmail = session.data?.user?.email || "";
  const initials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <SidebarProvider>
      <NavigationAutoClose />
      <TooltipProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="p-4">
            <span className="text-lg font-semibold">Admin</span>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const isActive =
                      location.pathname === item.href ||
                      location.pathname.startsWith(item.href + "/");

                    return (
                      <SidebarMenuItem key={item.href}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              asChild
                              isActive={isActive}
                              className="min-h-11"
                            >
                              <a
                                href={item.href}
                                aria-label={item.title}
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigate(item.href);
                                }}
                              >
                                <item.icon className="h-4 w-4" />
                                <span>{item.title}</span>
                              </a>
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent side="right">{item.title}</TooltipContent>
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
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-14 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-6" />
          </header>
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </TooltipProvider>
    </SidebarProvider>
  );
}

export function Component() {
  return (
    <AuthGuard>
      <AdminLayoutContent />
    </AuthGuard>
  );
}
