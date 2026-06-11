const fs = require('fs');
const content = fs.readFileSync('E:/code/AutoVis/apps/web/src/app/sections/ProjectsSection.tsx', 'utf8');
const lines = content.split('\n');

const typesContent = `import type { ReadyWorkspaceController } from "../../useWorkspaceController"

export type ProjectsSectionProps = {
  controller: ReadyWorkspaceController
}

export type EditTab = "basic" | "modules"

export type ProjectEditModalProps = ProjectsSectionProps & {
  isEditing: boolean
  setIsEditing: (v: boolean) => void
  editTab: EditTab
  setEditTab: (v: EditTab) => void
  newModuleName: string
  setNewModuleName: (v: string) => void
  newModuleDesc: string
  setNewModuleDesc: (v: string) => void
  authForm: { name: string; kind: string; hostPattern: string; username: string; secret: string }
  setAuthForm: (v: any) => void
}

export type ProjectsGridProps = ProjectsSectionProps & {
  setIsEditing: (v: boolean) => void
  setEditTab: (v: EditTab) => void
  confirmDeleteId: string | null
  setConfirmDeleteId: (v: string | null) => void
}
`;

fs.writeFileSync('E:/code/AutoVis/apps/web/src/app/sections/projects/types.ts', typesContent);

const gridContent = `import type { ProjectsGridProps } from "./types"
import { formatDateTime, translateStatus } from "../../utils"

// Git Host Badge mapping
function getGitBadgeInfo(url: string | undefined) {
  if (!url || !url.trim()) return null
  const lower = url.toLowerCase()
  if (lower.includes("github.com")) {
    return { name: "GitHub", color: "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700/80", icon: "code" }
  }
  if (lower.includes("gitlab.com")) {
    return { name: "GitLab", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20", icon: "code_blocks" }
  }
  if (lower.includes("gitee.com")) {
    return { name: "Gitee", color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20", icon: "terminal" }
  }
  return { name: "Git Repo", color: "bg-secondary text-secondary-foreground border-border", icon: "source_code" }
}

export function ProjectsGrid({ controller, setIsEditing, setEditTab, confirmDeleteId, setConfirmDeleteId }: ProjectsGridProps) {
  const { projects, selectedProject, projectWorkspace, busy, deleteProject, setSelectedProjectId, setProjectForm, setWorkspaceForm, setActiveSection } = controller
  
  return (
` + lines.slice(96, 317).join('\n') + `
  )
}
`;
fs.writeFileSync('E:/code/AutoVis/apps/web/src/app/sections/projects/ProjectsGrid.tsx', gridContent);

const modalContent = `import type { ProjectEditModalProps, EditTab } from "./types"
import { formatDateTime } from "../../utils"

export function ProjectEditModal({ controller, isEditing, setIsEditing, editTab, setEditTab, newModuleName, setNewModuleName, newModuleDesc, setNewModuleDesc, authForm, setAuthForm }: ProjectEditModalProps) {
  const {
    busy,
    modules,
    selectedProject,
    projectWorkspace,
    gitAuthProfiles,
    projectForm,
    workspaceForm,
    saveProject,
    saveWorkspace,
    importLocalWorkspace,
    uploadWorkspace,
    syncWorkspace,
    browseWorkspaceTree,
    saveGitAuthProfile,
    removeGitAuthProfile,
    setWorkspaceForm,
    saveModule,
    deleteModule,
    setProjectForm,
    setActiveSection,
  } = controller

  if (!isEditing) return null

  return (
` + lines.slice(320, 746).join('\n') + `
  )
}
`;
fs.writeFileSync('E:/code/AutoVis/apps/web/src/app/sections/projects/ProjectEditModal.tsx', modalContent);

const mainContent = `import { useState } from "react"
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
`;
fs.writeFileSync('E:/code/AutoVis/apps/web/src/app/sections/ProjectsSection.tsx', mainContent);
console.log("Done");
