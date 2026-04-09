"use client";

import { Suspense, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("billing");
  const tc = useTranslations("common");

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
      toast.success(t("toast.cancelled"));
      queryClient.invalidateQueries({ queryKey: ["billing", "subscription"] });
      setCancelOpen(false);
    },
    onError: () => {
      toast.error(t("toast.cancelFailed"));
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
      toast.error(t("toast.portalFailed"));
    },
  });

  if (subscriptionQuery.isPending) {
    return (
      <div aria-busy="true" aria-live="polite">
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
        <span className="sr-only">{tc("loading")}</span>
      </div>
    );
  }

  const subscription = subscriptionQuery.data as any;

  if (!subscription || !subscription.status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("subscription.noActive")}</CardTitle>
          <CardDescription>
            {t("subscription.noActiveDescription")}
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
            {t("subscription.viewPlans")}
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
            <CardTitle>{subscription.planName ?? t("subscription.currentPlan")}</CardTitle>
            <Badge variant={statusVariant(subscription.status)}>
              {subscription.status}
            </Badge>
          </div>
          {subscription.currentPeriodEnd && (
            <CardDescription>
              {t("subscription.periodEnds", {
                date: format(new Date(subscription.currentPeriodEnd), "MMMM d, yyyy"),
              })}
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
            {t("subscription.manageBilling")}
          </Button>
          {subscription.status === "active" && (
            <Button
              variant="destructive"
              onClick={() => setCancelOpen(true)}
            >
              {t("subscription.cancelSubscription")}
            </Button>
          )}
        </CardFooter>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("subscription.cancelTitle")}</DialogTitle>
            <DialogDescription>
              {t("subscription.cancelDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              {t("subscription.keepSubscription")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending && (
                <Loader2 className="animate-spin" />
              )}
              {t("subscription.confirmCancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PlanSelection() {
  const t = useTranslations("billing");

  // Template plan data -- users replace these with their actual Stripe price IDs
  const PLANS = [
    {
      key: "free",
      name: t("plans.free.name"),
      priceId: "price_free_placeholder",
      price: "$0",
      period: "forever",
      features: [
        t("plans.free.features.members"),
        t("plans.free.features.projects"),
        t("plans.free.features.storage"),
        t("plans.free.features.support"),
        t("plans.free.features.api"),
      ],
    },
    {
      key: "pro",
      name: t("plans.pro.name"),
      priceId: "price_pro_placeholder",
      price: "$29",
      period: "/month",
      features: [
        t("plans.pro.features.members"),
        t("plans.pro.features.projects"),
        t("plans.pro.features.storage"),
        t("plans.pro.features.support"),
        t("plans.pro.features.api"),
        t("plans.pro.features.analytics"),
        t("plans.pro.features.integrations"),
      ],
      popular: true,
    },
    {
      key: "enterprise",
      name: t("plans.enterprise.name"),
      priceId: "price_enterprise_placeholder",
      price: "$99",
      period: "/month",
      features: [
        t("plans.enterprise.features.everything"),
        t("plans.enterprise.features.storage"),
        t("plans.enterprise.features.support"),
        t("plans.enterprise.features.sla"),
        t("plans.enterprise.features.sso"),
      ],
    },
  ];

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
      toast.error(t("toast.checkoutFailed"));
    },
  });

  return (
    <div id="plan-selection" className="space-y-4">
      <h2 className="text-xl font-semibold">{t("plans.title")}</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <Card
            key={plan.key}
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
                  <Badge variant="secondary">{t("plans.popular")}</Badge>
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
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-center gap-2">
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
                {t("plans.subscribeTo", { planName: plan.name })}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}

function BillingHistory() {
  const t = useTranslations("billing");
  const tc = useTranslations("common");

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
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
        <span className="sr-only">{tc("loading")}</span>
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
            {t("history.empty")}
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
                {item.description ?? t("history.invoice")}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.date
                  ? format(new Date(item.date), "MMMM d, yyyy")
                  : "\u2014"}
              </p>
            </div>
            <span className="text-sm font-medium">
              {item.amount != null
                ? `$${(item.amount / 100).toFixed(2)}`
                : "\u2014"}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BillingContent() {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "subscription" });
  const t = useTranslations("billing");

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <Tabs value={tab ?? "subscription"} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="subscription" className="flex-1">{t("tabs.subscription")}</TabsTrigger>
          <TabsTrigger value="history" className="flex-1">{t("tabs.history")}</TabsTrigger>
          <TabsTrigger value="usage" className="flex-1">{t("tabs.usage")}</TabsTrigger>
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
                {t("usage.empty")}
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
