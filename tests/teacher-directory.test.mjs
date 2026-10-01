import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTeacherDirectory } from '../app/teacher-directory.ts';

function snapshot(users) {
  return { users, teacherAssignments: [], lessons: [], programs: [], grades: [],
    homework: [], achievements: [], comments: [], threads: [], classes: [] };
}
const manual = () => ({ id: 'manual', displayName: 'Тест Педагог', role: 'teacher',
  status: 'active', profileStatus: 'confirmed', identitySource: 'school_diary' });
const imported = () => ({ id: 'imported', displayName: 'Тест Педагог', role: 'teacher',
  status: 'setup', profileStatus: 'unconfirmed', identitySource: 'central_directory' });

test('an unassigned imported placeholder is not counted as a second working teacher', () => {
  const s = snapshot([manual(), imported()]); const before = structuredClone(s);
  const result = splitTeacherDirectory(s);
  assert.deepEqual(result.teachers.map(u => u.id), ['manual']);
  assert.deepEqual(result.pending.map(u => u.id), ['imported']);
  assert.deepEqual(s, before, 'separation must not mutate identities or history');
});
test('classification never uses names, fuzzy matches or initials as proof', () => {
  const s = snapshot([manual(), { ...manual(), id: 'namesake' },
    { ...imported(), displayName: 'Совсем Другой' }]);
  const r = splitTeacherDirectory(s);
  assert.deepEqual(r.teachers.map(u => u.id), ['manual', 'namesake']);
  assert.deepEqual(r.pending.map(u => u.id), ['imported']);
});
for (const key of ['teacherAssignments', 'lessons', 'programs', 'grades', 'homework',
  'achievements', 'comments', 'threads']) {
  test(`an imported profile already used in ${key} remains in the working directory`, () => {
    const s = snapshot([imported()]); s[key] = [{ teacherUserId: 'imported' }];
    assert.equal(splitTeacherDirectory(s).teachers.length, 1);
    assert.equal(splitTeacherDirectory(s).pending.length, 0);
  });
}
test('a homeroom teacher is not hidden', () => {
  const s = snapshot([imported()]); s.classes = [{ homeroomTeacherUserId: 'imported' }];
  assert.equal(splitTeacherDirectory(s).teachers.length, 1);
});
test('activated or confirmed central profiles remain in the working directory', () => {
  const s = snapshot([{ ...imported(), status: 'active' },
    { ...imported(), id: 'confirmed', profileStatus: 'confirmed' }]);
  assert.equal(splitTeacherDirectory(s).teachers.length, 2);
  assert.equal(splitTeacherDirectory(s).pending.length, 0);
});
test('archived, demo and non-teacher users are excluded from both lists', () => {
  const s = snapshot([{ ...imported(), status: 'archived' },
    { ...manual(), profileStatus: 'demo' }, { ...manual(), role: 'parent' }]);
  assert.deepEqual(splitTeacherDirectory(s), { teachers: [], pending: [] });
});
test('repeat projection retains the same IDs and does not alter the source array', () => {
  const s = snapshot([manual(), imported()]);
  assert.deepEqual(splitTeacherDirectory(s), splitTeacherDirectory(structuredClone(s)));
  assert.equal(s.users.length, 2);
});
