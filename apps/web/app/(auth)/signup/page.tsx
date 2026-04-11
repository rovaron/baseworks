"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,

  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@baseworks/ui";
import { auth } from "@/lib/api";
import { env } from "@/lib/env";
import { sanitizeInviteToken } from "@/lib/invite";

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = sanitizeInviteToken(searchParams.get("invite"));
  const inviteEmail = searchParams.get("email");
  const t = useTranslations("auth");

  const signupSchema = z.object({
    name: z.string().min(1, t("validation.nameRequired")),
    email: z.string().email(t("validation.emailRequired")),
    password: z.string().min(8, t("validation.passwordMin")),
  });

  type SignupValues = z.infer<typeof signupSchema>;

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: inviteEmail || "",
      password: "",
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: SignupValues) {
    const { error } = await auth.signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
    });

    if (error) {
      toast.error(error.message ?? t("toast.somethingWentWrong"));
      return;
    }

    // D-08: Auto-accept invitation on signup completion
    if (inviteToken) {
      try {
        await auth.organization.acceptInvitation({ invitationId: inviteToken });

        // Fetch invitation to get organizationId for setActive (Pitfall 3)
        const res = await fetch(
          `${env.NEXT_PUBLIC_API_URL}/api/invitations/${inviteToken}`
        );
        if (res.ok) {
          const invitation = await res.json();
          if (invitation?.organizationId) {
            await auth.organization.setActive({
              organizationId: invitation.organizationId,
            });
          }
        }

        router.push("/dashboard");
        return;
      } catch (autoAcceptError) {
        // If auto-accept fails (e.g., invitation was cancelled meanwhile),
        // still redirect to dashboard -- user has an account now
        console.error("[SIGNUP] Auto-accept failed:", autoAcceptError);
      }
    }

    router.push("/dashboard");
  }

  return (
    <Card className="w-full max-w-[400px]">
      <CardHeader className="text-center">
        <h1 className="text-2xl font-semibold leading-none tracking-tight">{t("createAccount")}</h1>
        <CardDescription>{t("createAccountDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("name")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("namePlaceholder")}
                      autoComplete="name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("email")}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={t("emailPlaceholder")}
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("password")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={t("passwordMinPlaceholder")}
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {t("createAccount")}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        {t("alreadyHaveAccount")}{" "}
        <Link href="/login" className="text-foreground font-medium hover:underline ml-1">
          {t("signIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
