import { RouterProvider } from "react-router";
import { Providers } from "./lib/providers";
import { router } from "./lib/router";
import { Toaster } from "sonner";

export function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
      <Toaster richColors closeButton />
    </Providers>
  );
}
