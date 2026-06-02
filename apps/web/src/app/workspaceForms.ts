import type { UpsertProjectRequest, UpsertProjectWorkspaceRequest, UpsertTaskRequest, UpsertTestCaseRequest } from "@autovis/shared"

export const emptyProjectForm = (): UpsertProjectRequest => ({ name: "", description: "", testBaseUrl: "", version: "" })

export const emptyWorkspaceForm = (): UpsertProjectWorkspaceRequest => ({
  sourceKind: "git",
  gitRepoUrl: "",
  localSourcePath: "",
  branch: "",
  ref: "",
  gitAuthProfileId: "",
})

export const emptyTaskForm = (): Omit<UpsertTaskRequest, "projectId"> => ({
  name: "",
  description: "",
  items: [],
  executionMode: { kind: "oneshot" },
})

export const emptyCaseForm = (): Omit<UpsertTestCaseRequest, "projectId"> => ({
  caseCode: "",
  moduleName: "",
  moduleId: "",
  purpose: "",
  dependencyCaseIds: [],
  authProfileId: undefined,
  steps: [""],
  expectedResult: "",
  testType: "functional",
  bugId: "",
  note: "",
  aiScript: "",
})
