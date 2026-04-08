"use client";

import { Suspense, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@baseworks/ui";
import { api } from "@/lib/api";
import { env } from "@/lib/env";

// Template plan data -- users replace these with their actual Stripe price IDs
const PLANS = [
  {
    name: "Free",
    priceId: "price_free_placeholder",
    price: "$0",
    period: "forever",
    features: [
      "1 workspace",
      "Up to 3 members",
      "Basic features",
      "Community support",
    ],
  },
  {
    name: "Pro",
    priceId: "price_pro_placeholder",
    price: "$29",
    period: "/month",
    features: [
      "Unlimited workspaces",
      "Up to 25 members",
      "All features",
      "Priority support",
      "Advanced analytics",
    ],
    popular: true,
  },
  {
    name: "Enterprise",
    priceId: "price_enterprise_placeholder",
    price: "$99",
    period: "/month",
    features: [
      "Unlimited everything",
      "Unlimited members",
      "All features",
      "Dedicated support",
      "Custom integrations",
      "SLA guarantee",
    ],
  },
];

function statusVariant(status: string) {
  switch (status) {
    case "active":
      return "default" as const;
    case "trialing":
      return "secondary" as const;
    case "canceled":
    case "cancelled":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function SubscriptionCard() {
  const [cancelOpen, setCancelOpen] = useState(false);
  const queryClient = useQueryClient();

  const subscriptionQuery = useQuery({
    queryKey: ["billing", "subscription"],
    queryFn: async () => {
      const { data, error } = await api.api.billing.subscription.get();
      if (error) throw error;
      return data;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.api.billing.cancel.post({});
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Subscription cancelled");
      queryClient.invalidateQueries({ queryKey: ["billing", "subscription"] });
      setCancelOpen(false);
    },
    onError: () => {
      toast.error("Failed to cancel subscription. Please try again.");
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.api.billing.portal.post({
        returnUrl: env.NEXT_PUBLIC_APP_URL + "/dashboard/billing",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast.error("Failed to open billing portal. Please try again.");
    },
  });

  if (subscriptionQuery.isPending) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-40" />
        </CardContent>
      </Card>
    );
  }

  const subscription = subscriptionQuery.data as any;

  if (!subscription || !subscription.status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No active subscription</CardTitle>
          <CardDescription>
            Choose a plan to unlock all features.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            variant="outline"
            onClick={() => {
              document
                .getElementById("plan-selection")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            View plans
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{subscription.planName ?? "Current Plan"}</CardTitle>
            <Badge variant={statusVariant(subscription.status)}>
              {subscription.status}
            </Badge>
          </div>
          {subscription.currentPeriodEnd && (
            <CardDescription>
              Current period ends{" "}
              {format(new Date(subscription.currentPeriodEnd), "MMMM d, yyyy")}
            </CardDescription>
          )}
        </CardHeader>
        <CardFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
          >
            {portalMutation.isPending && <Loader2 className="animate-spin" />}
            Manage billing
          </Button>
          {subscription.status === "active" && (
            <Button
              variant="destructive"
              onClick={() => setCancelOpen(true)}
            >
              Cancel subscription
            </Button>
          )}
        </CardFooter>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel subscription</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your subscription? You will lose
              access to premium features at the end of your current billing
              period.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep subscription
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending && (
                <Loader2 className="animate-spin" />
              )}
              Yes, cancel subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PlanSelection() {
  const checkoutMutation = useMutation({
    mutationFn: async (priceId: string) => {
      const { data, error } = await api.api.billing.checkout.post({
        priceId,
        successUrl:
          env.NEXT_PUBLIC_APP_URL + "/dashboard/billing?success=true",
        cancelUrl: env.NEXT_PUBLIC_APP_URL + "/dashboard/billing",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast.error("Failed to start checkout. Please try again.");
    },
  });

  return (
    <div id="plan-selection" className="space-y-4">
      <h2 className="text-xl font-semibold">Plans</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <Card
            key={plan.name}
            className={
              plan.popular
                ? "border-primary shadow-md"
                : undefined
            }
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {plan.name}
                {plan.popular && (
                  <Badge variant="secondary">Popular</Badge>
                )}
              </CardTitle>
              <CardDescription>
                <span className="text-2xl font-bold text-foreground">
                  {plan.price}
                </span>
                <span className="text-muted-foreground">{plan.period}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                variant={plan.popular ? "default" : "outline"}
                onClick={() => checkoutMutation.mutate(plan.priceId)}
                disabled={checkoutMutation.isPending}
              >
                {checkoutMutation.isPending && (
                  <Loader2 className="animate-spin" />
                )}
                Subscribe to {plan.name}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}

function BillingHistory() {
  const historyQuery = useQuery({
    queryKey: ["billing", "history"],
    queryFn: async () => {
      const { data, error } = await api.api.billing.history.get({
        query: { limit: "20", offset: "0" },
      });
      if (error) throw error;
      return data;
    },
  });

  if (historyQuery.isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const history = historyQuery.data as any;
  const items = Array.isArray(history) ? history : [];

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">
            No billing history yet. Your invoices will appear here after your
            first payment.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item: any, index: number) => (
        <Card key={item.id ?? index}>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
            <div>
              <p className="text-sm font-medium">
                {item.description ?? "Invoice"}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.date
                  ? format(new Date(item.date), "MMMM d, yyyy")
                  : "—"}
              </p>
            </div>
            <span className="text-sm font-medium">
              {item.amount != null
                ? `$${(item.amount / 100).toFixed(2)}`
                : "—"}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BillingContent() {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "subscription" });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Billing</h1>

      <Tabs value={tab ?? "subscription"} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="subscription" className="flex-1">Subscription</TabsTrigger>
          <TabsTrigger value="history" className="flex-1">History</TabsTrigger>
          <TabsTrigger value="usage" className="flex-1">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="subscription" className="space-y-8">
          <SubscriptionCard />
          <PlanSelection />
        </TabsContent>

        <TabsContent value="history">
          <BillingHistory />
        </TabsContent>

        <TabsContent value="usage">
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">
                Usage tracking is not yet configured. This section will display
                usage-based billing metrics when enabled.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingContent />
    </Suspense>
  );
}
