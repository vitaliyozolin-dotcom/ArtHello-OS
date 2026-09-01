import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";

export const SCHOOL_DEPLOY_READ_ONLY_MARKER =
  "/data/.school-deploy-read-only";
export const SCHOOL_DEPLOY_READ_ONLY_CODE = "deployment_read_only";
export const SCHOOL_DEPLOY_RETRY_AFTER_SECONDS = "30";

export function schoolDeployReadOnlyPayload() {
  return {
    error: "Система временно работает в режиме обслуживания",
    code: SCHOOL_DEPLOY_READ_ONLY_CODE,
  };
}

export function schoolDeployReadOnlyHeaders() {
  return {
    "cache-control": "no-store",
    "retry-after": SCHOOL_DEPLOY_RETRY_AFTER_SECONDS,
  };
}

export function schoolDeployReadOnlyState(environment = process.env) {
  const configuredPath = environment.SCHOOL_DEPLOY_READ_ONLY_FILE?.trim();
  const markerPath = configuredPath || SCHOOL_DEPLOY_READ_ONLY_MARKER;

  if (!isAbsolute(markerPath)) {
    return {
      active: true,
      markerPath,
      reason: "invalid_marker_path",
    };
  }

  try {
    lstatSync(markerPath);
    return { active: true, markerPath, reason: "marker_present" };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { active: false, markerPath, reason: "marker_absent" };
    }
    return { active: true, markerPath, reason: "marker_check_failed" };
  }
}
