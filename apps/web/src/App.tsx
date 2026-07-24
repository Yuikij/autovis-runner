import { apiRoutes } from "./app/apiRoutes"
import { appName } from "./app/constants"
import { t } from "./i18n/index.js"
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
    return <AppLoading message={t("app.checkingLogin")} />
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
    return <AppLoading message={t("app.loadingWorkspace")} />
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
              <h1 className="text-2xl font-semibold tracking-tight">{t("app.llmSessionFailed")}</h1>
              <p className="text-sm text-muted-foreground">{controller.error ?? t("app.checkConnection")}</p>
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
      setMessage(requestError.message || t("app.loginFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-6 p-7">
          <div className="space-y-2 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-3xl">lock</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{appName}</h1>
            <p className="text-sm text-muted-foreground">{t("app.signInTo")}</p>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <label className="setting-field" htmlFor="login-username">
              <span>{t("app.username")}</span>
              <input id="login-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label className="setting-field" htmlFor="login-password">
              <span>{t("app.password")}</span>
              <input id="login-password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {message ? <p className="text-sm text-destructive">{message}</p> : null}
            <button className="primary-button w-full" disabled={busy || !username || !password} type="submit">
              {busy ? t("app.signingIn") : t("app.signIn")}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
