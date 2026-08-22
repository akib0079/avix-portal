import { FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Download link for the Wise/bank payment-instructions PDF.
 *
 * A plain anchor, not a Button with an onClick: the file lives on the
 * marketing site, so the browser can fetch it directly and there is nothing
 * for JavaScript to do. That also means it works in the invoice email, where
 * no JavaScript runs at all.
 *
 * `download` asks the browser to save rather than navigate, and target/rel
 * cover the browsers that ignore `download` for cross-origin files and open a
 * tab instead — without rel="noreferrer" that tab could reach back through
 * window.opener.
 */
export function PaymentGuideButton({
  url,
  variant = "default",
  className,
}: {
  url: string;
  variant?: "default" | "subtle";
  className?: string;
}) {
  return (
    <a
      href={url}
      download
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
        variant === "default"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border bg-card text-foreground hover:bg-muted/60",
        className,
      )}
    >
      <FileDown className="size-4 shrink-0" />
      <span>Download payment guide (PDF)</span>
    </a>
  );
}
