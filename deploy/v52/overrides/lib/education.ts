export function attendanceSummary(rows: Array<{ attendanceStatus: string }>) {
  const total = rows.length;
  const present = rows.filter((row) => row.attendanceStatus === "Присутствовал").length;
  return { total, present, percent: total ? Math.round(present / total * 100) : 0 };
}
export type EducationScope = {
  kind: "all" | "branches" | "teacher" | "family" | "none";
  id: string;
  branchIds?: readonly string[];
};

/** Branch grants are loaded server-side; a section checkbox never grants branches. */
export type EducationScopeAccess = {
  sectionAllowed: boolean;
  unrestrictedOwner: boolean;
  branchIds: readonly string[];
};

export function educationScope(role: string, actorEntityId: string, access?: EducationScopeAccess): EducationScope {
  if (access) {
    if (!access.sectionAllowed) return { kind: "none", id: "" };
    const unrestrictedOwner = role === "OWNER" && access.unrestrictedOwner;
    const branches = unrestrictedOwner ? {} : { branchIds: [...new Set(access.branchIds)] };
    // A wider module assignment does not remove personal data boundaries.
    if (role === "TEACHER") return { kind: "teacher", id: actorEntityId, ...branches };
    if (role === "PARENT") return { kind: "family", id: actorEntityId, ...branches };
    return unrestrictedOwner ? { kind: "all", id: "" } : { kind: "branches", id: "", ...branches };
  }
  if (["OWNER","DIRECTOR","REPRESENTATIVE","METHODIST"].includes(role)) return { kind: "all", id: "" };
  if (role === "TEACHER") return { kind: "teacher", id: actorEntityId };
  if (role === "PARENT") return { kind: "family", id: actorEntityId };
  return { kind: "none", id: "" };
}

export function filterEducationScope<
  Group extends { id: string; teacherEntityId: string; unitEntityId: string },
  Student extends { id: string; groupId: string; familyEntityId: string },
>(scope: EducationScope, allGroups: readonly Group[], allStudents: readonly Student[]) {
  if (scope.kind === "none") return { groups: [] as Group[], students: [] as Student[] };
  const branches = scope.branchIds === undefined ? null : new Set(scope.branchIds);
  const familyGroupIds = new Set(allStudents.filter((row) => scope.id && row.familyEntityId === scope.id).map((row) => row.groupId));
  const groups = allGroups.filter((row) => {
    // Only this known legacy alias is accepted. The UI's unknown -> school
    // fallback must never be used as an authorization boundary.
    const branchId = row.unitEntityId === "UNT-T-001" ? "BR-SCHOOL" : row.unitEntityId;
    if (branches && !branches.has(branchId)) return false;
    if (scope.kind === "teacher") return Boolean(scope.id) && row.teacherEntityId === scope.id;
    if (scope.kind === "family") return Boolean(scope.id) && familyGroupIds.has(row.id);
    return true;
  });
  const groupIds = new Set(groups.map((row) => row.id));
  const students = allStudents.filter((row) => groupIds.has(row.groupId) && (scope.kind !== "family" || row.familyEntityId === scope.id));
  return { groups, students };
}
export function progressBand(score: number) { return score >= 80 ? "Уверенно" : score >= 60 ? "Формируется" : "Нужно наблюдение"; }
export function nextProgramVersion(version: number) { if (!Number.isInteger(version) || version < 1) throw new Error("Invalid program version"); return version + 1; }

export const EDUCATION_BRANCHES = [
  { id: "BR-KINDERGARTEN", label: "Атлас — садик" },
  { id: "BR-ATLAS-SCHOOL", label: "Атлас — школа" },
  { id: "BR-SCHOOL", label: "1–11" },
  { id: "BR-NEBO", label: "Небо" },
  { id: "BR-LISTVENNAYA", label: "Лиственная" },
] as const;

export function educationBranchId(unitEntityId: string) {
  if (unitEntityId === "UNT-T-001") return "BR-SCHOOL";
  return EDUCATION_BRANCHES.some((branch) => branch.id === unitEntityId) ? unitEntityId : "BR-SCHOOL";
}

export function parseEducationCsv(source: string) {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitCsvLine(lines[0], delimiter).map((value) => normalizeHeader(value));
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()]));
  }).filter((row) => Object.values(row).some(Boolean));
}

function normalizeHeader(value: string) {
  const key = value.trim().toLocaleLowerCase("ru").replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    "тип": "type", "type": "type", "название": "name", "name": "name", "филиал": "branchId", "branch": "branchId", "branchid": "branchId",
    "программа": "programId", "program": "programId", "programid": "programId", "педагог": "teacherId", "teacher": "teacherId", "teacherid": "teacherId",
    "кабинет": "room", "room": "room", "ребенок": "childId", "ребёнок": "childId", "childid": "childId", "семья": "familyId", "familyid": "familyId",
    "группа": "groupId", "group": "groupId", "groupid": "groupId", "дата": "scheduledAt", "scheduledat": "scheduledAt", "тема": "topic", "topic": "topic",
    "домашнеезадание": "homework", "homework": "homework",
  };
  return aliases[key] ?? value.trim();
}

function splitCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let value = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === delimiter && !quoted) { values.push(value); value = ""; continue; }
    value += char;
  }
  values.push(value);
  return values;
}
