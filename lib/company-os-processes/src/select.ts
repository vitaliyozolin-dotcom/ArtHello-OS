import { canRunOnRealData } from "./data-bindings";
import { PROCESS_LIBRARY } from "./registry";
import type { ProcessSelection, ProjectContext } from "./types";

export function selectProcesses(context: ProjectContext): ProcessSelection[] {
  if (
    context.expectedBenefit !== undefined &&
    context.expectedProcessCost !== undefined &&
    context.expectedProcessCost > context.expectedBenefit
  ) {
    return [];
  }

  const signalSet = new Set(context.signals);

  return Object.values(PROCESS_LIBRARY)
    .filter((process) => process.triggers.some((trigger) => signalSet.has(trigger)))
    .filter((process) => {
      if (!context.requireRealData) return true;
      return canRunOnRealData(process.id).allowed;
    })
    .map((process) => ({
      process,
      reason: `project:${context.projectId}; trigger:${process.triggers
        .filter((trigger) => signalSet.has(trigger))
        .join(",")}${context.requireRealData ? "; real-data:required" : ""}`,
    }));
}
