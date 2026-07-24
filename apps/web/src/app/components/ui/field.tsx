import * as React from "react"

import { cn } from "../../../lib/utils"

export const inputClassName = cn(
  "h-10 w-full rounded-lg border border-border bg-[hsl(var(--input))] px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20",
)

export const textareaClassName = cn(
  "min-h-24 w-full rounded-xl border border-border bg-[hsl(var(--input))] px-3 py-3 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20",
)

export function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <div className="space-y-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </label>
  )
}
