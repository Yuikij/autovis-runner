import { appName } from "./app/constants"
import { EmptyWorkspace } from "./app/EmptyWorkspace"
import { useWorkspaceController } from "./app/useWorkspaceController"
import { WorkspaceShell } from "./app/WorkspaceShell"
import { Card, CardContent } from "./app/components/ui/card"
import type { LoadedWorkspaceController, ReadyWorkspaceController } from "./app/useWorkspaceController"
import { useEffect, useState } from "react"

export function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const controller = useWorkspaceController()
  const navigate = (path: string) => {
    window.history.pushState(null, "", path)
    setPathname(path)
  }

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname)
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  if (!controller.initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-10">
        <Card className="w-full max-w-lg">
          <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-3xl">deployed_code</span>
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{appName}</h1>
              <p className="text-sm text-muted-foreground">正在加载工作台配置…</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!controller.llmSession) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-10">
        <Card className="w-full max-w-xl border-destructive/40">
          <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <span className="material-symbols-outlined text-3xl">error</span>
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">无法加载 LLM 会话</h1>
              <p className="text-sm text-muted-foreground">{controller.error ?? "请检查服务连接后重试。"}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const loadedController: LoadedWorkspaceController = {
    ...controller,
    llmSession: controller.llmSession,
  }

  if (!loadedController.selectedProject) {
    return <EmptyWorkspace controller={loadedController} />
  }

  const readyController: ReadyWorkspaceController = {
    ...loadedController,
    selectedProject: loadedController.selectedProject,
  }

  return <WorkspaceShell controller={readyController} />
}
