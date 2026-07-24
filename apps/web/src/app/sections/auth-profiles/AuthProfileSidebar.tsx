import type { AuthProfile } from "@autovis/shared"

export function AuthProfileSidebar({
  profiles,
  selectedId,
  onSelect,
  onEdit,
}: {
  profiles: AuthProfile[]
  selectedId: string | null
  onSelect: (id: string) => void
  onEdit: (profile: AuthProfile) => void
}) {
  return (
    <aside className="space-y-2 lg:sticky lg:top-4">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">登录态列表</span>
        <span className="text-[10px] font-mono text-muted-foreground">{profiles.length}</span>
      </div>
      <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
        {profiles.map((profile) => {
          const isActive = profile.id === selectedId
          const hasScript = Boolean(profile.validationScript)
          const hasAnyState = profile.states.some((s) => Boolean(s.storageStateJson))
          return (
            <div
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(profile.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelect(profile.id)
                }
              }}
              className={
                isActive
                  ? "w-full text-left rounded-2xl border border-primary/50 bg-primary/10 px-3.5 py-3 transition-all shadow-sm cursor-pointer"
                  : "w-full text-left rounded-2xl border border-border/60 bg-card/50 px-3.5 py-3 transition-all hover:border-border hover:bg-card cursor-pointer"
              }
            >
              <div className="flex items-center justify-between gap-2">
                <strong className={`text-sm truncate ${isActive ? "text-foreground" : "text-foreground/90"}`}>
                  {profile.name}
                </strong>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`size-1.5 rounded-full ${hasAnyState ? "bg-emerald-500" : "bg-rose-500"}`} title={hasAnyState ? "已有 storageState" : "无 storageState"} />
                  <span className={`size-1.5 rounded-full ${hasScript ? "bg-blue-500" : "bg-amber-500"}`} title={hasScript ? "已生成失效校验脚本" : "未生成失效校验脚本"} />
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onEdit(profile) }}
                    className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-secondary/60 transition-colors cursor-pointer"
                    title="编辑配置"
                  >
                    <span className="material-symbols-outlined text-[14px]">edit</span>
                  </button>
                </div>
              </div>
              {profile.description ? (
                <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{profile.description}</p>
              ) : null}
              <p className="mt-1 text-[10px] text-muted-foreground font-mono">
                {profile.states.length} 个 URL 状态
              </p>
            </div>
          )
        })}
        {profiles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/50 bg-card/30 py-10 text-center">
            <span className="material-symbols-outlined text-3xl opacity-50 text-muted-foreground">account_box</span>
            <p className="mt-2 text-xs text-muted-foreground">暂无登录态，点击右上角新建。</p>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
