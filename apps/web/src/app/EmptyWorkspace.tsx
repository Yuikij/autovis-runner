import type { LoadedWorkspaceController } from "./useWorkspaceController"
import { appName } from "./constants"
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
              <CardTitle className="text-3xl">欢迎使用 {appName}</CardTitle>
              <CardDescription>先创建一个项目，平台就会进入完整工作台，开始管理测试集、用例、脚本与执行过程。</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="项目名称">
              <input className={inputClassName} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} value={projectForm.name} />
            </Field>
            <Field label="项目描述">
              <textarea className={textareaClassName} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} value={projectForm.description} />
            </Field>
            {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">{error}</div> : null}
            <div className="flex justify-end">
              <Button disabled={busy} onClick={saveProject}>
                <span className="material-symbols-outlined text-base">rocket_launch</span>
                保存并进入工作台
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>当前系统状态</CardTitle>
            <CardDescription>在创建项目之前，你仍然可以确认模型连接与基础环境是否正常。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-border/80 bg-secondary/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">LLM 连接</p>
                  <p className="mt-1 text-sm font-medium">{llmSession.provider === "copilot-proxy" ? "Copilot" : "LLM API"} {llmSession.signedIn ? "已连接" : "待连接"}</p>
                </div>
                <Badge tone={llmSession.signedIn ? "success" : "warning"}>{llmSession.signedIn ? "在线" : "未连接"}</Badge>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{llmSession.model}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/80 bg-card/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">下一步</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">创建项目后即可继续维护测试集、编辑测试用例、生成脚本和执行验证。</p>
              </div>
              <div className="rounded-2xl border border-border/80 bg-card/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">建议</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">先配置项目基础信息，再进入测试集与 AI 工作台完成核心工作流。</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
