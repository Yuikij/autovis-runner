const fs = require('fs');
const content = fs.readFileSync('E:/code/AutoVis/apps/web/src/app/useWorkspaceController.ts', 'utf8');
const lines = content.split('\n');
const startIdx = lines.findIndex((l, i) => l.includes('useEffect(() => {') && lines[i+1].includes('!selectedProject?.testBaseUrl'));
const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('window.removeEventListener("hashchange", handleHashChange)') && lines[i+2].includes('}, [])')) + 2;

console.log('start', startIdx, 'end', endIdx);

if (startIdx !== -1 && endIdx !== -1) {
  const insert = `  useWorkspaceEffects({
    selectedProject, lastRunBaseUrl, setLastRunBaseUrl, selectedSuite,
    suiteForm, setSuiteForm, selectedCase, caseForm, setCaseForm,
    activeRun, setActiveRun, setWorkbenchVerificationRunId, projectRuns,
    agentSession, loadRun, selectedProjectId, terminalRunRefreshIds,
    setTerminalRunRefreshIds, loadProjectResources, callbackRef,
    activeSuiteRun, setSuiteRuns, suiteRuns, terminalSuiteRunRefreshIds,
    setTerminalSuiteRunRefreshIds, activeRecorderSession, setRecorderSessions,
    recorderSessions, selectedCaseId, loadScripts, terminalRecorderRefreshIds,
    setTerminalRecorderRefreshIds, setAgentSession, setBusy, llmSession,
    setClock, copilotPolling, clock, setCopilotPolling, copilotModel,
    loadLlmSession, setError, initialized, activeSection, selectedSuiteId,
    parseHash, setActiveSection, setSelectedProjectId, setSelectedSuiteId,
    setSelectedCaseId
  })`;
  lines.splice(startIdx, endIdx - startIdx + 1, insert);
  lines.splice(28, 0, 'import { useWorkspaceEffects } from "./hooks/useWorkspaceEffects"');
  fs.writeFileSync('E:/code/AutoVis/apps/web/src/app/useWorkspaceController.ts', lines.join('\n'));
  console.log('Done');
} else {
  console.log('Not found');
}
