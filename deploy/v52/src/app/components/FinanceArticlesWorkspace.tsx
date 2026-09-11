"use client";

import { useState, type FormEvent } from 'react';
import { previewArticleRule, type ArticleCatalog } from '../../lib/finance-articles';
import { Button, EmptyState } from './design-system';

const groupLabels = { operating: 'Операционная', investing: 'Инвестиционная', financing: 'Финансовая', internal: 'Внутренние переводы' };
const statusLabels = { draft: 'Черновик', active: 'Утверждена', archived: 'Архив' };
type PreviewOperation = Parameters<typeof previewArticleRule>[1][number];
type Props = {
  catalog: ArticleCatalog; permissions: { canEdit: boolean; canApprove: boolean }; operations: PreviewOperation[]; period: string; busy: boolean;
  action: (body: Record<string, unknown>, key: string) => Promise<boolean>;
  showOperations: (ids: string[]) => void;
};
export function FinanceArticlesWorkspace({ catalog, permissions, operations, period, busy, action, showOperations }: Props) {
  const [name, setName] = useState('');
  const [report, setReport] = useState('cashflow');
  const [direction, setDirection] = useState('Списание');
  const [group, setGroup] = useState('operating');
  const [articleId, setArticleId] = useState('');
  const [counterpartyInn, setInn] = useState('');
  const [purposeContains, setPurpose] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<null | ReturnType<typeof previewArticleRule>>(null);
  const [showArchive, setShowArchive] = useState(false);
  const visible = catalog.articles.filter(a => showArchive || a.status !== 'archived');
  async function create(event: FormEvent) {
    event.preventDefault();
    if (await action({ action: 'createArticle', catalogRevision: catalog.revision, name, report, direction, group }, 'article-create')) setName('');
  }
  function inspect(event: FormEvent) {
    event.preventDefault(); setError(''); setPreview(null);
    try { setPreview(previewArticleRule(catalog, operations, { articleId, period, counterpartyInn, purposeContains })); }
    catch (error) { setError(error instanceof Error ? error.message : 'Не удалось подобрать операции'); }
  }
  return <div className="ahFinanceArticles">
    <section className="finance-panel">
      <div className="finance-panel-head"><div><p>Справочник</p><h2>Статьи ДДС и ОПиУ</h2></div></div>
      <p>Утверждённый справочник зафиксирован как рабочая база. ДДС отражает движение денег, ОПиУ — доходы и расходы выбранного периода. Изменения справочника выполняются только по отдельному решению владельца.</p>
      {permissions.canEdit ? <form className="ahFinanceArticleForm" onSubmit={create}>
        <label><span>Название статьи</span><input required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label>
        <label><span>Отчёт</span><select value={report} onChange={e => setReport(e.target.value)}><option value="cashflow">ДДС</option><option value="pnl">ОПиУ</option></select></label>
        <label><span>{report === 'cashflow' ? 'Направление' : 'Тип статьи'}</span><select value={direction} onChange={e => setDirection(e.target.value)}><option value="Поступление">{report === 'cashflow' ? 'Поступления' : 'Доходы'}</option><option value="Списание">{report === 'cashflow' ? 'Списания' : 'Расходы'}</option></select></label>
        {report === 'cashflow' ? <label><span>Вид деятельности</span><select value={group} onChange={e => setGroup(e.target.value)}>{Object.entries(groupLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label> : null}
        <Button variant="primary" type="submit" disabled={busy}>Создать черновик</Button>
      </form> : null}
      <label className="ahFinanceArchiveToggle"><input type="checkbox" checked={showArchive} onChange={e => setShowArchive(e.target.checked)} />Показывать архив</label>
      {visible.length ? <ul className="ahFinanceArticleList">{visible.map(article => <li key={article.id}>
        <div><strong>{article.name}</strong><span>{article.report === 'cashflow' ? `ДДС · ${article.direction} · ${groupLabels[article.group]}` : `ОПиУ · ${article.direction === 'Поступление' ? 'Доходы' : 'Расходы'}`}</span></div>
        <span>{statusLabels[article.status]}</span>
        {permissions.canApprove && article.status !== 'archived' ? <div className="ahFinanceArticleActions">
          {article.status === 'draft' ? <Button disabled={busy} onClick={() => void action({ action: 'approveArticle', catalogRevision: catalog.revision, articleId: article.id }, article.id)}>Утвердить</Button> : null}
          <Button disabled={busy} onClick={() => void action({ action: 'archiveArticle', catalogRevision: catalog.revision, articleId: article.id }, article.id)}>В архив</Button>
        </div> : null}
      </li>)}</ul> : <EmptyState title="Статьи ещё не добавлены" description="Создайте черновики под ваш управленческий учёт. Существующие разнесения сохраняются." density="compact" />}
    </section>
    <section className="finance-panel">
      <div className="finance-panel-head"><div><p>Подбор для разнесения</p><h2>Проверить условия правила</h2></div></div>
      <p>Предпросмотр найдёт банковские операции без статьи за выбранный месяц. Все заполненные условия должны совпасть. Зафиксированные правила школы и садика применяются автоматически при банковском импорте.</p>
      <form className="ahFinanceArticleForm" onSubmit={inspect} onChange={() => { setPreview(null); setError(''); }}>
        <label><span>Статья ДДС</span><select required value={articleId} onChange={e => setArticleId(e.target.value)}><option value="">Выберите статью</option>{catalog.articles.filter(a => a.report === 'cashflow' && a.status === 'active').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label><span>ИНН контрагента — точное совпадение</span><input inputMode="numeric" maxLength={12} value={counterpartyInn} onChange={e => setInn(e.target.value)} /></label>
        <label><span>Назначение содержит</span><input maxLength={160} value={purposeContains} onChange={e => setPurpose(e.target.value)} /></label>
        <Button type="submit">Предпросмотр</Button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {preview ? <div role="status"><p>Найдено: {preview.count} · сумма {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(preview.amountMinor / 100)}</p>{preview.count ? <Button onClick={() => showOperations(preview.operationIds)}>Открыть операции</Button> : null}</div> : null}
    </section>
  </div>;
}
