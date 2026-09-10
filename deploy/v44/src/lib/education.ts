export function attendanceSummary(rows: Array<{ attendanceStatus: string }>) {
  const total = rows.length;
  const present = rows.filter((row) => row.attendanceStatus === "Присутствовал").length;
  return { total, present, percent: total ? Math.round(present / total * 100) : 0 };
}
export function educationScope(role: string, actorEntityId: string) {
  if (["OWNER","DIRECTOR","REPRESENTATIVE","METHODIST"].includes(role)) return { kind: "all", id: "" };
  if (role === "TEACHER") return { kind: "teacher", id: actorEntityId };
  if (role === "PARENT") return { kind: "family", id: actorEntityId };
  return { kind: "none", id: "" };
}
export function progressBand(score: number) { return score >= 80 ? "Уверенно" : score >= 60 ? "Формируется" : "Нужно наблюдение"; }
export function nextProgramVersion(version: number) { if (!Number.isInteger(version) || version < 1) throw new Error("Invalid program version"); return version + 1; }
