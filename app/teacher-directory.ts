import type { SchoolSnapshot, UserRecord } from './level-zero-types';

/** A directory import is not a second teaching account. Never merge by name. */
export function splitTeacherDirectory(snapshot: SchoolSnapshot) {
  const used = new Set<string>();
  const linkedCollections = [snapshot.teacherAssignments, snapshot.lessons,
    snapshot.programs, snapshot.grades, snapshot.homework, snapshot.achievements,
    snapshot.comments, snapshot.threads];
  for (const rows of linkedCollections) {
    for (const row of rows) if (row.teacherUserId) used.add(row.teacherUserId);
  }
  for (const row of snapshot.classes) {
    if (row.homeroomTeacherUserId) used.add(row.homeroomTeacherUserId);
  }
  const teachers: UserRecord[] = [];
  const pending: UserRecord[] = [];
  for (const user of snapshot.users) {
    if (user.role !== 'teacher' || user.status === 'archived' || user.profileStatus === 'demo') continue;
    const importedPlaceholder = user.identitySource === 'central_directory'
      && user.status === 'setup' && user.profileStatus === 'unconfirmed'
      && !used.has(user.id);
    (importedPlaceholder ? pending : teachers).push(user);
  }
  return { teachers, pending };
}
