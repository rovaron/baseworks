"use client";

import { useState } from "react";
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

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const t = useTranslations("auth");

  const forgotPasswordSchema = z.object({
    email: z.string().email(t("validation.emailRequired")),
  });

  type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: ForgotPasswordValues) {
    const { error } = await auth.forgetPassword({
      email: values.email,
      redirectTo: env.NEXT_PUBLIC_APP_URL + "/reset-password",
    });

    if (error) {
      toast.error(t("toast.somethingWentWrong"));
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <Card className="w-full max-w-[400px]">
        <CardHeader className="text-center">
          <h1 className="text-2xl font-semibold leading-none tracking-tight">{t("checkYourEmail")}</h1>
          <CardDescription>
            {t("checkEmailResetDescription")}
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Link href="/login">
            <Button variant="outline">{t("backToSignIn")}</Button>
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-[400px]">
      <CardHeader className="text-center">
        <h1 className="text-2xl font-semibold leading-none tracking-tight">{t("forgotPasswordTitle")}</h1>
        <CardDescription>
          {t("forgotPasswordDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {t("sendResetLink")}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="justify-center text-sm">
        <Link
          href="/login"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("backToSignIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
