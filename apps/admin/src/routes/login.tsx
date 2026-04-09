import { useState } from "react";
import { useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,

  Button,
  Input,
  Label,
} from "@baseworks/ui";
import { auth } from "@/lib/api";
import { toast } from "sonner";

type LoginValues = z.infer<ReturnType<typeof createLoginSchema>>;

function createLoginSchema(tAuth: (key: string) => string) {
  return z.object({
    email: z.string().email(tAuth("validation.emailRequired")),
    password: z.string().min(1, tAuth("validation.passwordRequired")),
  });
}

function LoginPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation("admin");
  const { t: tAuth } = useTranslation("auth");

  const loginSchema = createLoginSchema(tAuth);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginValues) {
    setIsLoading(true);
    try {
      const result = await auth.signIn.email({
        email: values.email,
        password: values.password,
      });

      if (result.error) {
        toast.error(result.error.message || t("toast.invalidCredentials"));
        return;
      }

      // Check if user has admin/owner role by listing organizations
      const orgsResult = await auth.organization.list();

      if (orgsResult.error || !orgsResult.data) {
        toast.error(t("toast.noAdminPrivileges"));
        await auth.signOut();
        return;
      }

      const hasOwnerRole = orgsResult.data.some(
        (membership: any) => membership.role === "owner",
      );

      if (!hasOwnerRole) {
        toast.error(t("toast.noAdminPrivileges"));
        await auth.signOut();
        return;
      }

      navigate("/");
    } catch {
      toast.error(t("toast.unexpectedError"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <h1 className="text-2xl font-semibold leading-none tracking-tight">{t("title")}</h1>
          <CardDescription>{t("signInToAdmin")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{tAuth("email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t("adminEmailPlaceholder")}
                autoComplete="email"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{tAuth("password")}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t("signingIn") : t("signInToAdmin")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function Component() {
  return <LoginPage />;
}
