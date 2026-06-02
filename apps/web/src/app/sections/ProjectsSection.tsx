import { useState } from "react"
import type { ProjectsSectionProps } from "./projects/types"
import type { EditTab } from "./projects/types"
import { ProjectsGrid } from "./projects/ProjectsGrid"
import { ProjectEditModal } from "./projects/ProjectEditModal"

export function ProjectsSection({ controller }: ProjectsSectionProps) {
  const { startNewProjectDraft, handleRefreshWorkspace, busy } = controller

  const [isEditing, setIsEditing] = useState(false)
  const [editTab, setEditTab] = useState<EditTab>("basic")
  const [newModuleName, setNewModuleName] = useState("")
  const [newModuleDesc, setNewModuleDesc] = useState("")
  const [authForm, setAuthForm] = useState({ name: "", kind: "http_token", hostPattern: "", username: "", secret: "" })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  return (
    <section className="space-y-6 animate-fade-in">
      {/* Section Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border/80">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest">项目结构</p>
          <h3 className="text-xl font-bold text-foreground mt-1">所有开发测试项目</h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
            type="button"
            onClick={() => {
              startNewProjectDraft()
              setIsEditing(true)
            }}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-sm">add</span>
            新建项目
          </button>
          <button
            className="h-9 px-4 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1"
            type="button"
            onClick={handleRefreshWorkspace}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            刷新
          </button>
        </div>
      </div>

      <ProjectsGrid 
        controller={controller}
        setIsEditing={setIsEditing}
        setEditTab={setEditTab}
        confirmDeleteId={confirmDeleteId}
        setConfirmDeleteId={setConfirmDeleteId}
      />

      <ProjectEditModal 
        controller={controller}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        editTab={editTab}
        setEditTab={setEditTab}
        newModuleName={newModuleName}
        setNewModuleName={setNewModuleName}
        newModuleDesc={newModuleDesc}
        setNewModuleDesc={setNewModuleDesc}
        authForm={authForm}
        setAuthForm={setAuthForm}
      />
    </section>
  )
}
