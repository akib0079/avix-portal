"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <p className="font-heading text-7xl font-bold text-primary">500</p>
      <h1 className="font-heading mt-4 text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        An unexpected error occurred. Try again — if it keeps happening,
        contact Avix Digital.
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
