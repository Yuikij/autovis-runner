import { useState } from "react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { inputClassName } from "../../components/ui/field"
import { t } from "../../../i18n/index.js"
import type { ReadyWorkspaceController } from "../../useWorkspaceController"

export type WorkbenchRepoViewProps = {
  controller: ReadyWorkspaceController
}

export function WorkbenchRepoView({ controller }: WorkbenchRepoViewProps) {
  const {
    projectWorkspace,
    workspaceTree,
    workspaceSearchResults,
    selectedWorkspaceFile,
    browseWorkspaceTree,
    searchWorkspace,
    openWorkspaceFile,
  } = controller

  const [workspaceQuery, setWorkspaceQuery] = useState("")

  return (
    <div className="p-5 flex flex-col h-[40rem] gap-4">
      <Card className="flex-1 min-h-0 flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm">{t("wb.repoBrowserTitle")}</CardTitle>
              <CardDescription>
                {projectWorkspace ? `${projectWorkspace.sourceKind} · ${projectWorkspace.status}` : t("wb.workspaceNotConfigured")}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <input
                className={`${inputClassName} h-8 text-xs w-44`}
                placeholder={t("wb.searchKeywordPlaceholder")}
                value={workspaceQuery}
                onChange={(event) => setWorkspaceQuery(event.target.value)}
              />
              <Button 
                variant="ghost" 
                className="h-8 text-xs cursor-pointer" 
                onClick={() => searchWorkspace(workspaceQuery)} 
                disabled={!projectWorkspace || !workspaceQuery.trim()}
              >
                {t("wb.search")}
              </Button>
              <Button 
                variant="ghost" 
                className="h-8 text-xs cursor-pointer" 
                onClick={() => browseWorkspaceTree()} 
                disabled={!projectWorkspace}
              >
                {t("wb.refreshTree")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[220px_1fr] flex-1 min-h-0">
          <div className="space-y-2 overflow-auto pr-1">
            {workspaceTree.length === 0 && workspaceSearchResults.length === 0 ? (
              <div className="text-xs text-muted-foreground">{t("wb.noTreeData")}</div>
            ) : (
              <>
                {workspaceTree.map((entry) => (
                  <button
                    key={`tree-${entry.path}`}
                    type="button"
                    className="w-full text-left rounded-lg border border-border/40 px-3 py-2 text-xs hover:bg-secondary/40 cursor-pointer"
                    onClick={() => entry.kind === "directory" ? browseWorkspaceTree(entry.path) : openWorkspaceFile(entry.path)}
                  >
                    <div className="font-mono truncate">{entry.path}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{entry.kind}</div>
                  </button>
                ))}
                {workspaceSearchResults.map((item) => (
                  <button
                    key={`search-${item.path}-${item.lineNumber}`}
                    type="button"
                    className="w-full text-left rounded-lg border border-border/40 px-3 py-2 text-xs hover:bg-secondary/40 cursor-pointer"
                    onClick={() => openWorkspaceFile(item.path)}
                  >
                    <div className="font-mono truncate">{item.path}:{item.lineNumber}</div>
                    <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{item.preview}</div>
                  </button>
                ))}
              </>
            )}
          </div>
          <pre className="min-h-[24rem] max-h-[32rem] overflow-auto rounded-xl border border-border/40 bg-secondary/20 p-4 text-xs leading-relaxed whitespace-pre-wrap break-all">
            {selectedWorkspaceFile?.content || t("wb.selectFileToView")}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
