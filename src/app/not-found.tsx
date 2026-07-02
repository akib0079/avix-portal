import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <p className="font-heading text-7xl font-bold text-primary">404</p>
      <h1 className="font-heading mt-4 text-2xl font-bold">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or you don&apos;t
        have access to it.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to the portal</Link>
      </Button>
    </div>
  );
}
