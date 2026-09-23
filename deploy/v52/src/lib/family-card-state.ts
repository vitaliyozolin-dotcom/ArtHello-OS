type FamilyStateInput = {
  status: string; sourceSystem: string; dataQuality: string; metadata: string;
  hasNameCollision?: boolean;
};
type DetailEvidence = { parentName?: string; parentNames?: string[]; hasDuplicate?: boolean };
type Issue = { code: string; reason: string; action: string; target: 'edit' | 'source' | 'identity' };
const sourceStatuses = new Set(['Активен', 'Активен ШКОЛА', 'Открыто', 'Разовое посещение', 'Запись', 'Пробное занятие', 'Завершил']);
const unknownStatus = 'Статус в AlfaCRM не подтверждён';
export function isSourceOwnedFamilyField(key: string) {
  return /^alfa/i.test(key) || ['customerLifecycle','attendanceFormat','canonicalId','branchAssignments','identitySourceStatus','localArchive','remoteBranchId','localBranchId','sourceLocalBranchId','guardianName'].includes(key);
}
export function editableFamilyExtras(values: Record<string, unknown>) {
  // The editor round-trips hidden fields as text; only editable values may override stored metadata.
  return Object.fromEntries(Object.entries(values).filter(([key]) =>
    !isSourceOwnedFamilyField(key)
    && !/^(?:id|sourceSystem|sourceRecordId|dataQuality|metadata|createdAt|updatedAt)$/i.test(key)
    && !/(?:Id|Ids)$/.test(key)
    && !/(?:^|[_-])ids?$/i.test(key)
  ));
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Presentation only. No status inference, duplicate merging or access changes. */
export function familyCardState(family: FamilyStateInput, detail?: DetailEvidence) {
  let meta: Record<string, unknown> = {};
  try { meta = object(JSON.parse(family.metadata)); } catch { /* retain unknown evidence */ }
  const alfa = family.sourceSystem === 'ALFACRM';
  const assignments = Array.isArray(meta.branchAssignments)
    ? meta.branchAssignments.map(object).filter(row => row.active === true) : [meta];
  const statusName = (row: Record<string, unknown>) => typeof row.alfaStatusName === 'string' && sourceStatuses.has(row.alfaStatusName.trim()) ? row.alfaStatusName.trim() : unknownStatus;
  const customerStatus = alfa ? assignments.map(row => `${typeof row.scope === 'string' && row.scope ? row.scope + ': ' : ''}${statusName(row)}`).join('; ') || unknownStatus : 'Не связан с AlfaCRM';
  const cardStatus = family.status === 'Активна' ? 'Текущая' : family.status;
  const issues: Issue[] = [];
  if (family.status === 'Архив' || family.status === 'Объединена') return { customerStatus, cardStatus, issues };
  if (family.hasNameCollision || detail?.hasDuplicate) issues.push({code:'name-collision',reason:'Есть другая карточка с таким же названием',action:'Сравните детей, представителей и исходные карточки в «Единых карточках». Не объединяйте семьи только по совпадению имени.',target:'identity'});
  // The list has no linked representative evidence; do not guess from old import metadata.
  const parentNames = detail?.parentNames ?? [detail?.parentName ?? ''];
  if (detail && !parentNames.some(name => name.trim() && name.trim() !== 'Представитель семьи')) issues.push({code:'parent-missing',reason:'Не указан родитель или представитель',action:'Укажите ФИО представителя в разделе «Родитель / представитель» и проверьте, что он относится к этому ребёнку.',target:'edit'});
  if (alfa && (!assignments.length || assignments.some(row => statusName(row) === unknownStatus))) issues.push({code:'source-status',reason:'Нет подтверждённого статуса AlfaCRM',action:'Уточните статус в исходной карточке AlfaCRM. После исправления выполните предпросмотр и синхронизацию; статус не назначается по предположению.',target:'source'});
  if (family.sourceSystem !== 'MANUAL' && family.dataQuality !== 'Проверено') issues.push({code:'import-review',reason:'Данные импорта ещё не подтверждены',action:'Сопоставьте ребёнка, представителя и филиалы с AlfaCRM. После проверки отметьте «Сверка внешнего источника завершена» в редакторе. Простое сохранение сверку не завершает.',target:'edit'});
  else if (family.dataQuality === 'Требует сверки' || family.dataQuality === 'На проверке') issues.push({code:'record-review',reason:'Проверка данных карточки не завершена',action:'Откройте редактор и проверьте ребёнка, представителя и филиал. Если причина не указана, обратитесь к ответственному за карточку.',target:'edit'});
  return { customerStatus, cardStatus, issues };
}
