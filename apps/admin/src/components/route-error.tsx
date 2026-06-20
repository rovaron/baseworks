import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@baseworks/ui";
import { AlertTriangle } from "lucide-react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";

function getErrorMessage(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unexpected error occurred.";
}

export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();

  if (import.meta.env.DEV) {
    // Surface the original error in the console for debugging.
    console.error("Route error boundary caught:", error);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            <CardTitle>Something went wrong</CardTitle>
          </div>
          <CardDescription>
            The page failed to load. This is usually temporary — try reloading or going back.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground break-words">
            {getErrorMessage(error)}
          </p>
        </CardContent>
        <CardFooter className="gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
