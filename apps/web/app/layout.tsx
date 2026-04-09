import type { Metadata } from "next";
import { Toaster } from "@baseworks/ui/components/sonner";
import { Providers } from "@/lib/providers";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Baseworks",
  description: "SaaS starter kit",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers locale={locale} messages={messages}>
          {children}
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
