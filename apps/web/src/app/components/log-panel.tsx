import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { cn } from "../../lib/utils"

type LogPanelProps = {
  title: string
  content: string
  noCard?: boolean
  className?: string
}

export function LogPanel({ title, content, noCard = false, className = "" }: LogPanelProps) {
  const contentElement = (
    <pre
      className={cn(
        "overflow-auto whitespace-pre-wrap rounded-xl bg-slate-100 dark:bg-slate-950/70 p-4 text-xs leading-6 text-slate-800 dark:text-slate-200 font-mono",
        className || "max-h-72"
      )}
    >
      {content || "无输出日志"}
    </pre>
  )

  if (noCard) {
    return contentElement
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {contentElement}
      </CardContent>
    </Card>
  )
}
