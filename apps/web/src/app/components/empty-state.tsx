import { Button } from "./ui/button"
import { Card, CardContent } from "./ui/card"

type EmptyStateProps = {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Card className="border-dashed bg-card/70">
      <CardContent className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-4xl">deployed_code</span>
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold">{title}</h3>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {actionLabel && onAction ? (
          <Button onClick={onAction}>
            <span className="material-symbols-outlined text-base">arrow_forward</span>
            {actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
