"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackRecord, FeedbackStatus } from '../../lib/developer-feedback';
import './DeveloperFeedback.css';

const kinds = { bug: 'Ошибка', suggestion: 'Предложение' } as const;
const statuses: Record<FeedbackStatus, string> = { new: 'Новое', reviewing: 'На рассмотрении', planned: 'Запланировано', done: 'Готово', declined: 'Отклонено' };
type FeedbackList = { items: FeedbackRecord[]; nextBefore: number | null; canManage: boolean };
type View = 'create' | 'mine' | 'all';

async function api<T>(path: string, body?: unknown): Promise<T> {
  const csrf = document.cookie.split('; ').find((cookie) => cookie.startsWith('__Host-arthello_csrf='))?.slice('__Host-arthello_csrf='.length) ?? '';
  const result = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: { error?: string } & T;
  try { data = await result.json() as typeof data; }
  catch { throw new Error('Сервис обращений временно недоступен. Повторите попытку.'); }
  if (!result.ok) throw new Error(data.error ?? 'Не удалось выполнить запрос. Повторите попытку.');
  return data;
}

export function DeveloperFeedback({ moduleId }: { moduleId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const submissionId = useRef('');
  const submittedModule = useRef('');
  const loadVersion = useRef(0);
  const [open, setOpen] = useState(false), [view, setView] = useState<View>('create');
  const [kind, setKind] = useState<keyof typeof kinds>('bug');
  const [title, setTitle] = useState(''), [body, setBody] = useState('');
  const [list, setList] = useState<FeedbackList>({ items: [], nextBefore: null, canManage: false });
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');

  const load = useCallback(async (scope: 'mine' | 'all', before?: number) => {
    const version = ++loadVersion.current;
    setLoading(true); setError('');
    try {
      const data = await api<FeedbackList>(`/api/developer-feedback?scope=${scope}${before ? `&before=${before}` : ''}`);
      if (version === loadVersion.current) setList((current) => ({ ...data, items: before ? [...current.items, ...data.items] : data.items }));
    } catch (cause) { if (version === loadVersion.current) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить обращения'); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  function close() { if (!saving) { setOpen(false); trigger.current?.focus(); } }
  function changed() { submissionId.current = ''; setNotice(''); }
  function selectView(next: View) { setView(next); setError(''); setList((current) => ({ ...current, items: [], nextBefore: null })); void load(next === 'all' ? 'all' : 'mine'); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    if (!submissionId.current) { submissionId.current = crypto.randomUUID(); submittedModule.current = moduleId; }
    setSaving(true); setError(''); setNotice('');
    try {
      await api('/api/developer-feedback', { action: 'create', submissionId: submissionId.current, kind, title, body, moduleId: submittedModule.current });
      setTitle(''); setBody(''); submissionId.current = '';
      setNotice('Обращение сохранено. Его статус виден в списке.');
      setView('mine'); await load('mine');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить обращение'); }
    finally { setSaving(false); }
  }
  async function setStatus(item: FeedbackRecord, status: FeedbackStatus) {
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await api<{ item: FeedbackRecord }>('/api/developer-feedback', { action: 'setStatus', id: item.id, revision: item.revision, status });
      setList((current) => ({ ...current, items: current.items.map((row) => row.id === item.id ? result.item : row) }));
      setNotice('Статус сохранён.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить статус'); }
    finally { setSaving(false); }
  }

  return <>
    <button ref={trigger} type="button" className="ahFeedbackTrigger" onClick={() => { setOpen(true); void load(view === 'all' ? 'all' : 'mine'); }} aria-haspopup="dialog">Разработчикам</button>
    <dialog ref={dialog} className="ahFeedbackDialog" aria-labelledby="ahFeedbackHeading" onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => setOpen(false)}>
      <header><div><p>ArtHello OS</p><h2 id="ahFeedbackHeading">Разработчикам</h2></div><button type="button" onClick={close} disabled={saving} aria-label="Закрыть обращения">×</button></header>
      <nav aria-label="Обращения"><button type="button" aria-pressed={view === 'create'} onClick={() => selectView('create')} disabled={saving}>Написать</button><button type="button" aria-pressed={view === 'mine'} onClick={() => selectView('mine')} disabled={saving}>Мои обращения</button>{list.canManage ? <button type="button" aria-pressed={view === 'all'} onClick={() => selectView('all')} disabled={saving}>Все обращения</button> : null}</nav>
      {notice ? <p role="status" className="ahFeedbackNotice">{notice}</p> : null}
      {error ? <p role="alert" className="ahFeedbackError">{error}</p> : null}
      {view === 'create' ? <form onSubmit={submit}>
        <label>Тип обращения<select value={kind} onChange={(event) => { changed(); setKind(event.target.value as keyof typeof kinds); }} disabled={saving}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Тема<input value={title} onChange={(event) => { changed(); setTitle(event.target.value); }} maxLength={160} required disabled={saving} /></label>
        <label>Описание<textarea value={body} onChange={(event) => { changed(); setBody(event.target.value); }} maxLength={6000} rows={6} required disabled={saving} placeholder={kind === 'bug' ? 'Что вы делали, что произошло и какой результат ожидали?' : 'Что стоит изменить и как это поможет в работе?'} /></label>
        <p className="ahFeedbackHint">Обращение сохраняется в системе и доступно вам и собственнику.</p>
        <footer><button type="button" onClick={close} disabled={saving}>Закрыть</button><button type="submit" disabled={saving || !title.trim() || !body.trim()}>{saving ? 'Сохраняем…' : 'Отправить'}</button></footer>
      </form> : <section aria-label={view === 'all' ? 'Все обращения' : 'Мои обращения'} aria-busy={loading}>
        <div className="ahFeedbackListActions"><button type="button" onClick={() => void load(view)} disabled={loading || saving}>Обновить список</button></div>
        {!loading && !error && !list.items.length ? <p className="ahFeedbackEmpty">Обращений пока нет.</p> : null}
        {list.items.map((item) => <article key={item.id} className="ahFeedbackCard"><div className="ahFeedbackMeta"><span>{kinds[item.kind]}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('ru-RU')}</time></div><h3>{item.title}</h3>{view === 'all' ? <p className="ahFeedbackAuthor">{item.author_name}</p> : null}<p className="ahFeedbackBody">{item.body}</p>{view === 'all' && list.canManage ? <label>Статус<select aria-label={`Статус обращения: ${item.title}`} value={item.status} disabled={saving} onChange={(event) => void setStatus(item, event.target.value as FeedbackStatus)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <p className="ahFeedbackStatus">{statuses[item.status]}</p>}</article>)}
        {loading ? <p role="status">Загружаем обращения…</p> : null}
        {list.nextBefore ? <button type="button" onClick={() => void load(view, list.nextBefore ?? undefined)} disabled={loading || saving}>Показать ещё</button> : null}
      </section>}
    </dialog>
  </>;
}
