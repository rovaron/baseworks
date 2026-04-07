"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@baseworks/ui";
import { useTenant } from "@/components/tenant-provider";

export default function DashboardPage() {
  const { activeTenant, isLoading } = useTenant();

  const tenantName = activeTenant?.name ?? "your workspace";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <Card>
        <CardHeader>
          <CardTitle>
            {isLoading ? "Loading..." : `Welcome to ${tenantName}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Get started by exploring your dashboard. Use the sidebar to navigate
            between sections.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
