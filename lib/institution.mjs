export const institution = Object.freeze({
  id: "atlas-school",
  systemId: "SYS-SCHOOL-ATLAS",
  branchId: "BR-ATLAS-SCHOOL",
  name: "Школа Атлас",
});

export function assertInstitution(payload) {
  if (payload?.systemId !== institution.systemId || payload?.branchId !== institution.branchId)
    throw new Error("Запрос относится к другому учебному учреждению");
}

// Deliberately refuses an unmarked pre-existing School database, even if a wrong
// DATABASE_PATH is provided. Never imports or relabels another institution.
export function claimAtlasDatabase(sqlite) {
  const hasIdentity = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='diary_identity'").get();
  if (hasIdentity) {
    const identity = sqlite.prepare("SELECT institution_id FROM diary_identity WHERE id='primary'").get();
    if (identity?.institution_id !== institution.id) throw new Error("База принадлежит другому учреждению");
    return;
  }
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (tables.length) throw new Error("Атлас запускается только на новой базе или базе с подтверждённой принадлежностью");
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec("CREATE TABLE diary_identity (id text PRIMARY KEY NOT NULL, institution_id text NOT NULL)");
    sqlite.prepare("INSERT INTO diary_identity VALUES ('primary', ?)").run(institution.id);
    sqlite.exec("COMMIT");
  } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
}
