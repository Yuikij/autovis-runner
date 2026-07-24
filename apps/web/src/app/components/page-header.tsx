import { cn } from "../../lib/utils"

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/80 pb-5 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p> : null}
        <h2 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className={cn("flex flex-wrap items-center gap-3")}>{actions}</div> : null}
    </div>
  )
}
