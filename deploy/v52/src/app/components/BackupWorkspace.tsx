"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "./design-system";

type BackupStatus = {
  state: "idle" | "running" | "failed";
  lastAttemptAt: string | null;
  schedule: { enabled: boolean; nextAt: string | null; lastTriggeredAt: string | null };
  retentionDays: number;
  history: Array<{ id: string; completedAt: string; bytes: number; status: "verified_at_creation" }>;
  unreadableCopies: number;
};

export function BackupWorkspace({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<BackupStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/backups", { cache: "no-store" });
      const result = await response.json() as BackupStatus & { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось проверить резервные копии");
      setData(result);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось проверить резервные копии"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (data?.state !== "running" || error) return;
    const timer = window.setTimeout(() => void load(), 3000);
    return () => window.clearTimeout(timer);
  }, [data, error, load]);

  async function createBackup() {
    if (busy) return;
    setBusy(true);
    try {
      const csrf = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("__Host-arthello_csrf="))?.slice("__Host-arthello_csrf=".length) ?? "";
      const response = await fetch("/api/settings/backups", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf) }, body: JSON.stringify({ action: "create" }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось запустить резервную копию");
      notify("Создание копии запущено. Результат появится после проверки восстановления.");
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Не удалось запустить резервную копию"); }
    finally { await load(); setBusy(false); }
  }

  if (loading) return <EmptyState title="Проверяем резервные копии" description="Получаем состояние расписания и сохранённых копий." />;
  if (error || !data) return <EmptyState title="Резервные копии недоступны" description={error || "Состояние сервера не получено."} action={<Button variant="secondary" onClick={() => void load()}>Проверить снова</Button>} />;
  const last = data.history[0];
  return <div className="settings-grid">
    <article className="settings-card wide">
      <header><div><p>Сохранность данных</p><h3>Резервные копии</h3></div></header>
      <p>Сохраняется база ArtHello: семьи, сотрудники, финансы и настройки. Каждая новая копия проходит пробное восстановление базы перед добавлением в историю.</p>
      <dl>
        <div><dt>Последняя копия</dt><dd>{last ? formatDate(last.completedAt) : "Успешных копий пока нет"}</dd></div>
        <div><dt>Автоматическое копирование</dt><dd>{data.schedule.enabled ? "Включено" : "Не включено"}</dd></div>
        <div><dt>Следующий запуск</dt><dd>{data.schedule.enabled ? formatDate(data.schedule.nextAt) : "Расписание не действует"}</dd></div>
        <div><dt>Срок хранения</dt><dd>{data.retentionDays} дней</dd></div>
      </dl>
      <p role="status" aria-live="polite">{data.state === "running" ? "Создаём копию и проверяем восстановление. Можно закрыть настройки: работа продолжится на сервере." : data.state === "failed" ? `Последняя попытка не завершилась успешно${data.lastAttemptAt ? ` (${formatDate(data.lastAttemptAt)})` : ""}. Ранее сохранённые копии остаются в истории.` : "Сервис готов к созданию копии."}</p>
      <div className="access-form-actions">
        <Button variant="secondary" onClick={() => void load()}>Обновить состояние</Button>
        <Button disabled={busy || data.state === "running"} onClick={() => void createBackup()}>{busy || data.state === "running" ? "Создаём копию…" : "Создать резервную копию"}</Button>
      </div>
    </article>
    <article className="settings-card wide">
      <header><div><p>Сохранённые данные</p><h3>История копий</h3></div><span>{data.history.length}</span></header>
      {data.unreadableCopies > 0 ? <p role="alert">Есть копии с неполными или повреждёнными файлами: {data.unreadableCopies}. Они не включены в список доступных копий.</p> : null}
      {data.history.length ? <div className="branch-list">{data.history.map((item) => <div key={item.id}><div><strong>{formatDate(item.completedAt)}</strong><small>{formatBytes(item.bytes)} · Проверена при создании</small></div></div>)}</div> : <p>После первой успешной проверки здесь появится резервная копия.</p>}
    </article>
    <div className="settings-boundary"><strong>Что входит в копию</strong><span>Копия содержит базу данных ArtHello и хранится на том же сервере. Данные и файлы дневника, внешние документы и серверные ключи в эту копию не входят. Для восстановления рабочей системы обратитесь к разработчикам: сначала проверяется копия и совместимость версии.</span></div>
  </div>;
}

function formatDate(value: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value)) + " МСК" : "Не подтверждено"; }
function formatBytes(value: number) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value / 1048576) + " МБ"; }
