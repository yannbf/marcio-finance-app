import { cn } from "@/lib/utils"

type SkeletonProps = React.ComponentProps<"div"> & {
  /** Render as a different element. Use "span" inside <p> / inline runs. */
  as?: "div" | "span"
}

function Skeleton({ className, as: As = "div", ...props }: SkeletonProps) {
  return (
    <As
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
