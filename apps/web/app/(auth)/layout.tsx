import { SkipToContent } from "@baseworks/ui/components/skip-link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SkipToContent />
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
    </div>
  );
}
