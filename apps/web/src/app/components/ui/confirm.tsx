import * as React from "react"
import { Button } from "./button"

type ConfirmOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: "primary" | "danger"
}

type ConfirmContextType = (options: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmContextType | null>(null)

export function useConfirm() {
  const context = React.useContext(ConfirmContext)
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmProvider")
  }
  return context
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{
    isOpen: boolean
    options: ConfirmOptions
    resolve: (value: boolean) => void
  } | null>(null)

  const confirm = React.useCallback((options: ConfirmOptions | string) => {
    return new Promise<boolean>((resolve) => {
      const resolvedOptions =
        typeof options === "string"
          ? { message: options, variant: "danger" as const }
          : options
      setState({
        isOpen: true,
        options: resolvedOptions,
        resolve,
      })
    })
  }, [])

  const handleCancel = () => {
    if (state) {
      state.resolve(false)
      setState(null)
    }
  }

  const handleConfirm = () => {
    if (state) {
      state.resolve(true)
      setState(null)
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state?.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 cursor-pointer animate-in fade-in"
            onClick={handleCancel}
          />
          {/* Dialog Container */}
          <div className="relative w-full max-w-md bg-card border border-border/80 rounded-2xl shadow-soft overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-4">
                <div className={`flex size-10 items-center justify-center rounded-full shrink-0 ${
                  state.options.variant === "danger"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary"
                }`}>
                  <span className="material-symbols-outlined text-xl">
                    {state.options.variant === "danger" ? "warning" : "info"}
                  </span>
                </div>
                <div className="flex-1 space-y-1">
                  <h3 className="text-base font-semibold leading-6 text-foreground">
                    {state.options.title || "确认操作"}
                  </h3>
                  <p className="text-sm text-muted-foreground break-words whitespace-pre-line">
                    {state.options.message}
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={handleCancel}
                  className="cursor-pointer min-w-[70px]"
                >
                  {state.options.cancelText || "取消"}
                </Button>
                <Button
                  variant={state.options.variant === "danger" ? "danger" : "primary"}
                  onClick={handleConfirm}
                  className="cursor-pointer min-w-[70px]"
                >
                  {state.options.confirmText || "确定"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
