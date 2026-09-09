const previewRoles = new Set(['director', 'deputy']);
export function mayPreviewParent(role) { return previewRoles.has(role); }
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));

// Explicit allowlists: adding a field to the staff snapshot never exposes it here.
export function projectParentPreview(snapshot, studentId) {
  if (!mayPreviewParent(snapshot.viewer.role)) throw new Error('preview_denied');
  const student = snapshot.students.find(row => row.id === studentId);
  if (!student) throw new Error('preview_denied');
  const own = rows => rows.filter(row => row.studentId === studentId);
  const inClass = rows => rows.filter(row => row.className === student.className && row.status !== 'archived');
  return {
    mode: 'parent-academic-preview', readOnly: true,
    student: pick(student, ['id', 'firstName', 'fullName', 'className']),
    lessons: inClass(snapshot.lessons).map(row => pick(row, ['id','weekday','startsAt','endsAt','subjectName','teacherName','room'])),
    homework: inClass(snapshot.homework).map(row => pick(row, ['id','subjectName','title','description','dueAt'])),
    grades: own(snapshot.grades).map(row => pick(row, ['id','subjectName','value','weight','title','gradeDate','comment'])),
    comments: own(snapshot.comments).filter(row => row.visibility === 'parent').map(row => pick(row, ['id','teacherName','subjectName','body','commentDate'])),
    achievements: own(snapshot.achievements).map(row => pick(row, ['id','title','description','achievementDate'])),
    attendance: own(snapshot.attendance).map(row => pick(row, ['id','lessonId','status','markedAt'])),
  };
}
