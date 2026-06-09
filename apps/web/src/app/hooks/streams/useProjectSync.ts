import { useCallback, useEffect, useRef } from "react"

import type { TestCase } from "@autovis/shared"

type ProjectSyncParams = {
  selectedProjectId: string | null
  loadProjectResources: (projectId: string) => Promise<void>
  loadAllTestCases: () => Promise<TestCase[]>
}

export type ProjectSync = {
  /**
   * Signal that an entity (run / task-run / recorder / agent) reached a
   * terminal state. Deduped by id, then folded into a single coalesced refresh.
   */
  onTerminal: (id: string) => void
  /** Schedule a coalesced project refresh without a dedupe id. */
  scheduleRefresh: () => void
}

// Burst window: multiple terminal events arriving close together collapse into
// a single project refresh instead of N full refetches.
const COALESCE_DELAY_MS = 350

/**
 * The single source of truth for "refresh project data after something
 * finished". Replaces the three `terminal*RefreshIds` state arrays and the
 * per-hook dedupe `Set`s, and enforces two invariants:
 *
 *  - at most one in-flight project refresh (single-flight);
 *  - bursts of terminal events coalesce into one refresh (no request storm).
 */
export function useProjectSync(params: ProjectSyncParams): ProjectSync {
  const paramsRef = useRef(params)
  useEffect(() => {
    paramsRef.current = params
  }, [params])

  const seenTerminalIds = useRef<Set<string>>(new Set())
  const debounceTimer = useRef<number | null>(null)
  const running = useRef(false)
  const rerunRequested = useRef(false)

  const runRefresh = useCallback(async () => {
    const { selectedProjectId, loadProjectResources, loadAllTestCases } = paramsRef.current
    if (!selectedProjectId) return
    if (running.current) {
      // A refresh is already in flight; ask it to run once more when it lands
      // rather than launching a parallel duplicate.
      rerunRequested.current = true
      return
    }
    running.current = true
    try {
      do {
        rerunRequested.current = false
        const projectId = paramsRef.current.selectedProjectId
        if (!projectId) break
        await Promise.all([
          paramsRef.current.loadProjectResources(projectId),
          paramsRef.current.loadAllTestCases(),
        ])
      } while (rerunRequested.current)
    } catch {
      // Errors are surfaced by the underlying loaders; the coordinator must
      // never throw, otherwise a single failed refresh would wedge the loop.
    } finally {
      running.current = false
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = window.setTimeout(() => {
      debounceTimer.current = null
      void runRefresh()
    }, COALESCE_DELAY_MS)
  }, [runRefresh])

  const onTerminal = useCallback((id: string) => {
    if (!id || seenTerminalIds.current.has(id)) return
    seenTerminalIds.current.add(id)
    scheduleRefresh()
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
