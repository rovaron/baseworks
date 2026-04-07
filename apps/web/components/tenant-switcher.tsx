"use client";

import { ChevronsUpDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Avatar,
  AvatarFallback,
  cn,
} from "@baseworks/ui";
import { useTenant } from "./tenant-provider";

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TenantSwitcher() {
  const { activeTenant, tenants, setActiveTenant } = useTenant();

  // Single tenant or no tenants -- nothing to switch
  if (tenants.length <= 1) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            "outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          )}
        >
          <Avatar className="h-6 w-6">
            <AvatarFallback className="text-xs">
              {activeTenant ? getInitials(activeTenant.name) : "?"}
            </AvatarFallback>
          </Avatar>
          <span className="flex-1 truncate font-medium">
            {activeTenant?.name ?? "Select tenant"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {tenants.map((tenant) => (
          <DropdownMenuItem
            key={tenant.id}
            onClick={() => setActiveTenant(tenant.id)}
            className="flex items-center gap-2"
          >
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[10px]">
                {getInitials(tenant.name)}
              </AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate">{tenant.name}</span>
            {activeTenant?.id === tenant.id && (
              <Check className="h-4 w-4 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
