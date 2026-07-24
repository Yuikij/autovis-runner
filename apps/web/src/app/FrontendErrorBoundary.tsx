import { Component, type ErrorInfo, type ReactNode } from "react"

import { recordFrontendDiagnostic } from "./frontendDiagnostics"
import { t } from "../i18n/index.js"

type FrontendErrorBoundaryProps = {
  section: string
  onGoDashboard: () => void
  children: ReactNode
}

type FrontendErrorBoundaryState = {
  error: Error | null
}

export class FrontendErrorBoundary extends Component<FrontendErrorBoundaryProps, FrontendErrorBoundaryState> {
  public state: FrontendErrorBoundaryState = {
    error: null,
  }

  public static getDerivedStateFromError(error: Error) {
    return { error }
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    recordFrontendDiagnostic({
      source: "react-error-boundary",
      level: "error",
      title: t("boundary.diagTitle"),
      message: error.message || t("boundary.diagMessage"),
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      meta: {
        section: this.props.section,
      },
    })
  }

  public componentDidUpdate(prevProps: FrontendErrorBoundaryProps) {
    if (prevProps.section !== this.props.section && this.state.error) {
      this.setState({ error: null })
    }
  }

  public render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-destructive">error</span>
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t("boundary.renderFailed")}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("boundary.body")}
              </p>
            </div>
            <p className="break-all rounded-xl border border-destructive/20 bg-background/50 px-3 py-2 font-mono text-[11px] text-destructive">
              {this.state.error.message}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={this.props.onGoDashboard}
                className="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground transition hover:bg-secondary"
              >
                {t("boundary.goDashboard")}
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground transition hover:bg-secondary"
              >
                {t("boundary.reload")}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}