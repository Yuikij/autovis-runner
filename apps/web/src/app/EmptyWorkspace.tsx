import type { LoadedWorkspaceController } from "./useWorkspaceController"
import { appName } from "./constants"
import { t } from "../i18n/index.js"
import { Badge } from "./components/ui/badge"
import { Button } from "./components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card"
import { Field, inputClassName, textareaClassName } from "./components/ui/field"

type EmptyWorkspaceProps = {
  controller: LoadedWorkspaceController
}

export function EmptyWorkspace({ controller }: EmptyWorkspaceProps) {
  const { busy, error, llmSession, projectForm, saveProject, setProjectForm } = controller

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <div className="space-y-2">
              <Badge>Workspace Bootstrap</Badge>
              <CardTitle className="text-3xl">{t("empty.welcome", { name: appName })}</CardTitle>
              <CardDescription>{t("empty.intro")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label={t("empty.projectName")}>
              <input className={inputClassName} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} value={projectForm.name} />
            </Field>
            <Field label={t("empty.projectDesc")}>
              <textarea className={textareaClassName} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} value={projectForm.description} />
            </Field>
            {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div> : null}
            <div className="flex justify-end">
              <Button disabled={busy} onClick={saveProject}>
                <span className="material-symbols-outlined text-base">rocket_launch</span>
                {t("empty.saveEnter")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("empty.systemStatus")}</CardTitle>
            <CardDescription>{t("empty.statusIntro")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-border/80 bg-secondary/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("empty.llmConnection")}</p>
                  <p className="mt-1 text-sm font-medium">{llmSession.provider === "copilot-proxy" ? "Copilot" : "LLM API"} {llmSession.signedIn ? t("shell.connected") : t("shell.pendingConnection")}</p>
                </div>
                <Badge tone={llmSession.signedIn ? "success" : "warning"}>{llmSession.signedIn ? t("shell.online") : t("shell.offline")}</Badge>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{llmSession.model}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/80 bg-card/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("empty.nextStep")}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("empty.nextStepBody")}</p>
              </div>
              <div className="rounded-2xl border border-border/80 bg-card/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("empty.advice")}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("empty.adviceBody")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
