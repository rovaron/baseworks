"use client";

import { useRouter } from "next/navigation";
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

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("auth");

  const loginSchema = z.object({
    email: z.string().email(t("validation.emailRequired")),
    password: z.string().min(1, t("validation.passwordRequired")),
  });

  type LoginValues = z.infer<typeof loginSchema>;

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: LoginValues) {
    const { error } = await auth.signIn.email({
      email: values.email,
      password: values.password,
    });

    if (error) {
      toast.error(t("toast.invalidCredentials"));
      return;
    }

    router.push("/dashboard");
  }

  async function handleOAuth(provider: "google" | "github") {
    await auth.signIn.social({
      provider,
      callbackURL: "/dashboard",
    });
  }

  return (
    <Card className="w-full max-w-[400px]">
      <CardHeader className="text-center">
        <h1 className="text-2xl font-semibold leading-none tracking-tight">{t("signIn")}</h1>
        <CardDescription>{t("signInDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            type="button"
            onClick={() => handleOAuth("google")}
          >
            {t("continueWithGoogle")}
          </Button>
          <Button
            variant="outline"
            type="button"
            onClick={() => handleOAuth("github")}
          >
            {t("continueWithGithub")}
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">{t("or")}</span>
          </div>
        </div>

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
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("password")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={t("passwordPlaceholder")}
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {t("signIn")}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 text-sm">
        <Link
          href="/forgot-password"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("forgotPassword")}
        </Link>
        <Link
          href="/magic-link"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("signInWithMagicLink")}
        </Link>
        <div className="text-muted-foreground">
          {t("noAccount")}{" "}
          <Link href="/signup" className="text-foreground font-medium hover:underline">
            {t("createAccount")}
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
