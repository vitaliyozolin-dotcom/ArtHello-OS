export type DirectoryClass = { id: string; name: string; grade: number; localId?: string };
type Group = { id: string; branchId: string; status: string; teacherId: string };
type Membership = { childId: string; familyId: string; groupId: string; displayName: string };
type Teacher = { id: string; displayName: string };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(id);

export function buildDiaryDirectory(branchId: string, sequence: number, classes: DirectoryClass[], groups: Group[], memberships: Membership[], teachers: Teacher[]) {
  if (!['BR-SCHOOL','BR-ATLAS-SCHOOL'].includes(branchId) || !Number.isSafeInteger(sequence) || sequence < 1 || !Array.isArray(classes) || classes.length === 0 || classes.length > 100) throw new Error('Не подтверждены школа или классы');
  const seen=new Set<string>(), names=new Set<string>();
  for(const row of classes) {
    const group=groups.find(g=>g.id===row?.id && g.branchId===branchId && g.status==='Активна');
    if(!group || !validId(row.id) || seen.has(row.id) || typeof row.name!=='string' || !row.name.trim() || row.name.length>200 || names.has(row.name) || !Number.isInteger(row.grade) || row.grade<0 || row.grade>11 || (row.localId!==undefined && !validId(row.localId))) throw new Error('Сопоставление класса не подтверждено');
    seen.add(row.id);names.add(row.name);
  }
  const students=new Map<string,{id:string;firstName:string;lastName:string;classId:string;familyId:string}>(), families=new Set<string>();
  for(const row of memberships.filter(row=>seen.has(row.groupId))) {
    if(!validId(row.childId) || !validId(row.familyId) || !row.displayName.trim() || row.displayName.length>200) throw new Error('Не подтверждены ученик или семья');
    const previous=students.get(row.childId);
    if(previous && (previous.classId!==row.groupId || previous.familyId!==row.familyId)) throw new Error('У ученика противоречивые назначения класса или семьи');
    // Preserve the full source display name. Do not guess which token is a surname.
    students.set(row.childId,{id:row.childId,firstName:row.displayName,lastName:'',classId:row.groupId,familyId:row.familyId});families.add(row.familyId);
  }
  const teacherIds=new Set(groups.filter(g=>seen.has(g.id)).map(g=>g.teacherId).filter(Boolean));
  const selectedTeachers=teachers.filter(t=>teacherIds.has(t.id));
  if(selectedTeachers.some(t=>!validId(t.id) || !t.displayName.trim()) || new Set(selectedTeachers.map(t=>t.id)).size!==selectedTeachers.length) throw new Error('Не подтверждены идентификаторы педагогов');
  return {version:1,sequence,complete:true,classes:classes.map(row=>({...row})),students:[...students.values()],families:[...families].sort().map(id=>({id})),teachers:selectedTeachers.map(row=>({...row}))};
}
