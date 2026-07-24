import { useCallback, useEffect, useRef } from "react"

/**
 * What a terminal event invalidates. The stream hook that observed the event
 * knows its own kind, so it can declare precisely which project data became
 * stale — letting the coordinator refresh only those endpoints instead of
 * refetching the entire project ("all" is the explicit full-refresh escape).
 */
export type RefreshScope = "tasks" | "runs" | "taskRuns" | "recorder" | "cases" | "all"

export type ProjectRefreshLoaders = {
  loadProjectResources: (projectId: string) => Promise<unknown>
  loadTasks: (projectId: string) => Promise<unknown>
  loadProjectRuns: (projectId: string) => Promise<unknown>
  loadTaskRuns: (projectId: string) => Promise<unknown>
  loadRecorderSessions: (projectId: string) => Promise<unknown>
  loadTestCases: (projectId: string) => Promise<unknown>
  loadAllTestCases: () => Promise<unknown>
}

type ProjectSyncParams = {
  selectedProjectId: string | null
  loaders: ProjectRefreshLoaders
}

export type ProjectSync = {
  /**
   * Signal that an entity reached a terminal state. Deduped by id; the declared
   * scopes are accumulated and folded into a single coalesced refresh.
   */
  onTerminal: (id: string, scopes: RefreshScope[]) => void
  /** Schedule a coalesced refresh of the given scopes without a dedupe id. */
  scheduleRefresh: (scopes: RefreshScope[]) => void
}

// Burst window: multiple terminal events arriving close together collapse into
// a single refresh instead of N refetches.
const COALESCE_DELAY_MS = 350

/**
 * The single source of truth for "refresh project data after something
 * finished". Replaces the three `terminal*RefreshIds` state arrays and the
 * per-hook dedupe `Set`s, and enforces these invariants:
 *
 *  - at most one in-flight refresh (single-flight);
 *  - bursts of terminal events coalesce into one refresh (no request storm);
 *  - only the declared scopes are refetched, not the whole project.
 */
export function useProjectSync(params: ProjectSyncParams): ProjectSync {
  const paramsRef = useRef(params)
  useEffect(() => {
    paramsRef.current = params
  }, [params])

  const seenTerminalIds = useRef<Set<string>>(new Set())
  const pendingScopes = useRef<Set<RefreshScope>>(new Set())
  const debounceTimer = useRef<number | null>(null)
  const running = useRef(false)

  const runRefresh = useCallback(async () => {
    if (running.current) {
      // A refresh is already in flight; it will drain `pendingScopes` when it
      // finishes rather than launching a parallel duplicate.
      return
    }
    running.current = true
    try {
      while (pendingScopes.current.size > 0) {
        const scopes = pendingScopes.current
        pendingScopes.current = new Set()

        const { selectedProjectId, loaders } = paramsRef.current
        if (!selectedProjectId) break

        if (scopes.has("all")) {
          await loaders.loadProjectResources(selectedProjectId).catch(() => undefined)
          continue
        }

        const jobs: Array<Promise<unknown>> = []
        if (scopes.has("tasks")) jobs.push(loaders.loadTasks(selectedProjectId))
        if (scopes.has("runs")) jobs.push(loaders.loadProjectRuns(selectedProjectId))
        if (scopes.has("taskRuns")) jobs.push(loaders.loadTaskRuns(selectedProjectId))
        if (scopes.has("recorder")) jobs.push(loaders.loadRecorderSessions(selectedProjectId))
        if (scopes.has("cases")) {
          jobs.push(loaders.loadTestCases(selectedProjectId))
          jobs.push(loaders.loadAllTestCases())
        }
        // Never throw out of the coordinator: a single failed loader must not
        // wedge the drain loop or leave `running` stuck.
        await Promise.allSettled(jobs)
      }
    } finally {
      running.current = false
    }
  }, [])

  const scheduleRefresh = useCallback((scopes: RefreshScope[]) => {
    for (const scope of scopes) {
      pendingScopes.current.add(scope)
    }
    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = window.setTimeout(() => {
      debounceTimer.current = null
      void runRefresh()
    }, COALESCE_DELAY_MS)
  }, [runRefresh])

  const onTerminal = useCallback((id: string, scopes: RefreshScope[]) => {
    if (!id || seenTerminalIds.current.has(id)) return
    seenTerminalIds.current.add(id)
    scheduleRefresh(scopes)
  }, [scheduleRefresh])

  // Re-entering a project should be allowed to refresh again on new terminals.
  useEffect(() => {
    seenTerminalIds.current.clear()
  }, [params.selectedProjectId])

  useEffect(() => () => {
    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current)
    }
  }, [])

  return { onTerminal, scheduleRefresh }
}
