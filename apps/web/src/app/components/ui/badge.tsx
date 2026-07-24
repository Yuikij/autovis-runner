import { cn } from "../../../lib/utils"

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "default" | "success" | "warning" | "danger" | "info"
}

export function Badge({ className, tone = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        tone === "default" && "border-border bg-secondary text-secondary-foreground",
        tone === "success" && "border-success/30 bg-success/10 text-emerald-700 dark:text-green-300",
        tone === "warning" && "border-warning/30 bg-warning/10 text-amber-700 dark:text-amber-300",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-red-700 dark:text-red-300",
        tone === "info" && "border-primary/30 bg-primary/10 text-blue-700 dark:text-blue-300",
        className,
      )}
      {...props}
    />
  )
}
