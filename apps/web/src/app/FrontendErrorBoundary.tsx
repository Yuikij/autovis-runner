import { Component, type ErrorInfo, type ReactNode } from "react"

import { recordFrontendDiagnostic } from "./frontendDiagnostics"

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
      title: "页面组件渲染失败",
      message: error.message || "组件渲染期间发生错误",
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
              <h3 className="text-sm font-semibold text-foreground">当前页面组件渲染失败</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                错误已经写入仪表盘中的前端诊断面板。你可以切回总览查看详情，或刷新页面后重试。
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
                前往总览
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground transition hover:bg-secondary"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}