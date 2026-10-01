"""One-shot deterministic source edit. No production access or data changes."""
from pathlib import Path
from hashlib import sha256
p=Path('app/school-app.tsx'); raw=p.read_bytes()
assert sha256(raw).hexdigest()=='3d16a71e39f5933f35d69bbac05acd093b50daa8e02e0a282f58df2b3349ce59', 'SOURCE_MOVED'
s=raw.decode()
def replace(old,new):
    global s
    assert s.count(old)==1, ('SOURCE_CONTRACT',old[:80])
    s=s.replace(old,new)
replace('import { Icon, type IconName } from "./icons";', 'import { Icon, type IconName } from "./icons";\nimport { splitTeacherDirectory } from "./teacher-directory";')
replace('function StaffDirectory({ snapshot }: { snapshot: SchoolSnapshot }) {\n  const teachers = snapshot.users.filter((user) => user.role === "teacher" && user.status !== "archived" && user.profileStatus !== "demo");', '''function StaffDirectory({ snapshot, pending = false }: { snapshot: SchoolSnapshot; pending?: boolean }) {
  const directory = splitTeacherDirectory(snapshot);
  const teachers = pending ? directory.pending : directory.teachers;''')
replace('const [directoryTab, setDirectoryTab] = useState<"students" | "classes" | "teachers">("students");', 'const [directoryTab, setDirectoryTab] = useState<"students" | "classes" | "teachers" | "imports">("students");')
replace('  const teachers = snapshot.users.filter((user) => user.role === "teacher" && user.status !== "archived" && user.profileStatus !== "demo");\n  const unresolved = teachers.filter((user) => user.profileStatus !== "confirmed");', '''  const { teachers, pending } = splitTeacherDirectory(snapshot);
  const unresolved = [...teachers, ...pending].filter((user) => user.profileStatus !== "confirmed");''')
replace('{ id: "teachers", label: `Педагоги · ${teachers.length}` }]}', '{ id: "teachers", label: `Педагоги · ${teachers.length}` }, { id: "imports", label: `Из ОС · ${pending.length}` }]}')
replace('title="Педагогический состав" subtitle={`${unresolved.length} позиций требуют решения`}', 'title="Педагогический состав" subtitle="Карточки педагогов с сохранёнными назначениями"')
old='      {directoryTab === "teachers" ? <section className="content-card"><SectionTitle title="Педагогический состав" subtitle="Карточки педагогов с сохранёнными назначениями" /><StaffDirectory snapshot={snapshot} /></section> : null}'
replace(old,old+'''
      {directoryTab === "imports" ? <section className="content-card"><SectionTitle title="Неподтверждённые записи из ОС" subtitle="Эти записи пока не входят в педагогический состав" /><div className="form-explainer"><Icon name="info" /><p><strong>Это записи импорта, а не вторые учителя.</strong><span>Совпадение ФИО не подтверждает личность. Записи и история сохранены; автоматического объединения и выдачи доступа нет.</span></p></div>{pending.length ? <StaffDirectory snapshot={snapshot} pending /> : <EmptyState title="Нет неподтверждённых записей импорта" text="Рабочие карточки находятся во вкладке «Педагоги»." icon="users" />}</section> : null}''')
p.write_text(s)
print('TEACHER_DIRECTORY_SOURCE_EDIT=APPLIED_NO_PRODUCTION')
