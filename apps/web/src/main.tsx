import React from "react"
import ReactDOM from "react-dom/client"

import { App } from "./App"
import { startFrontendDiagnostics } from "./app/frontendDiagnostics"
import { ConfirmProvider } from "./app/components/ui/confirm"
import "./index.css"

startFrontendDiagnostics()

document.documentElement.classList.add("icons-pending")
document.fonts.ready.then(() => {
  return document.fonts.load('20px "Material Symbols Outlined"', 'dashboard')
}).finally(() => {
  document.documentElement.classList.remove("icons-pending")
})

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </React.StrictMode>,
)

