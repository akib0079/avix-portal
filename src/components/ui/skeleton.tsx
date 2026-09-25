import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        // A highlight swept across by transform (compositor-only), instead
        // of the whole block fading — reads as "loading", not "broken".
        "relative overflow-hidden rounded-md bg-muted after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_ease-in-out_infinite] after:bg-gradient-to-r after:from-transparent after:via-foreground/[0.06] after:to-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
