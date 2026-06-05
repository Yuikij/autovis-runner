import { apiRoutes } from "./app/apiRoutes"
import { appName } from "./app/constants"
import { EmptyWorkspace } from "./app/EmptyWorkspace"
import { request, type RequestError } from "./app/api"
import { useWorkspaceController } from "./app/useWorkspaceController"
import { WorkspaceShell } from "./app/WorkspaceShell"
import { Card, CardContent } from "./app/components/ui/card"
import type { LoadedWorkspaceController, ReadyWorkspaceController } from "./app/useWorkspaceController"
import { FormEvent, useEffect, useState } from "react"

export interface AuthSession {
  authEnabled: boolean
  llmScope: "shared" | "per_user"
  user: { id: string; username: string; role: "admin" | "user" } | null
}

export function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const loadAuthSession = async () => {
    setAuthLoading(true)
    try {
      const result = await request<AuthSession>(apiRoutes.auth.session())
      setAuthSession(result.data)
      setAuthError(null)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to load session")
      setAuthSession({ authEnabled: false, llmScope: "shared", user: null })
    } finally {
      setAuthLoading(false)
    }
  }

  useEffect(() => {
    void loadAuthSession()
  }, [])

  const logout = async () => {
    await request<boolean>(apiRoutes.auth.logout(), { method: "POST" }).catch(() => undefined)
    await loadAuthSession()
  }

  if (authLoading || !authSession) {
    return <AppLoading message="正在检查登录状态..." />
  }

  if (authSession.authEnabled && !authSession.user) {
    return <LoginPage error={authError} onLoggedIn={setAuthSession} />
  }

  return <WorkspaceApp authSession={authSession} onLogout={logout} />
}

function WorkspaceApp({ authSession, onLogout }: { authSession: AuthSession; onLogout: () => Promise<void> }) {
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
    return <AppLoading message="正在加载工作台配置..." />
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

  return <WorkspaceShell authSession={authSession} controller={readyController} onLogout={onLogout} />
}

function AppLoading({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <Card className="w-full max-w-lg">
        <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-3xl">deployed_code</span>
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{appName}</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function LoginPage({ error, onLoggedIn }: { error: string | null; onLoggedIn: (session: AuthSession) => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(error)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const result = await request<AuthSession>(apiRoutes.auth.login(), {
        method: "POST",
        body: JSON.stringify({ username, password }),
      })
      onLoggedIn(result.data)
    } catch (err) {
      const requestError = err as RequestError
      setMessage(requestError.message || "登录失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-background dark:from-indigo-500/20 dark:via-purple-500/10 dark:to-background">
      {/* Decorative background blobs */}
      <div className="absolute top-1/4 left-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 opacity-50 blur-[100px] transition-all duration-1000 animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 h-80 w-80 translate-x-1/4 translate-y-1/4 rounded-full bg-accent/20 opacity-50 blur-[80px] transition-all duration-1000 animate-pulse delay-700" />
      
      <div className="z-10 w-full max-w-md animate-in fade-in zoom-in-95 duration-500 px-6">
        <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-white/60 p-8 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-black/40">
          <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent opacity-50 dark:from-white/5" />
          
          <div className="relative z-10 space-y-8">
            <div className="space-y-3 text-center">
              <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/30 ring-4 ring-primary/10">
                <span className="material-symbols-outlined text-3xl">lock</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">{appName}</h1>
              <p className="text-sm font-medium text-muted-foreground">欢迎回来，请输入您的凭据以继续</p>
            </div>

            <form className="space-y-5" onSubmit={submit}>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold tracking-wide text-foreground/80" htmlFor="login-username">
                    用户名
                  </label>
                  <div className="group relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-muted-foreground transition-colors group-focus-within:text-primary">person</span>
                    <input
                      id="login-username"
                      autoComplete="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="h-12 w-full rounded-xl border border-border bg-background/50 pl-11 pr-4 text-sm outline-none transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20"
                      placeholder="admin"
                    />
                  </div>
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold tracking-wide text-foreground/80" htmlFor="login-password">
                    密码
                  </label>
                  <div className="group relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-xl text-muted-foreground transition-colors group-focus-within:text-primary">key</span>
                    <input
                      id="login-password"
                      autoComplete="current-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-12 w-full rounded-xl border border-border bg-background/50 pl-11 pr-4 text-sm outline-none transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </div>

              {message ? (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive animate-in slide-in-from-top-2">
                  <span className="material-symbols-outlined text-lg">error</span>
                  <p>{message}</p>
                </div>
              ) : null}

              <button
                className="group relative w-full overflow-hidden rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-md"
                disabled={busy || !username || !password}
                type="submit"
              >
                <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-100%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(100%)]">
                  <div className="relative h-full w-8 bg-white/20" />
                </div>
                <span className="relative flex items-center justify-center gap-2">
                  {busy ? (
                    <>
                      <span className="material-symbols-outlined animate-spin">progress_activity</span>
                      登录中...
                    </>
                  ) : (
                    <>
                      登录
                      <span className="material-symbols-outlined text-lg transition-transform group-hover:translate-x-1">arrow_forward</span>
                    </>
                  )}
                </span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
