"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FALLBACK_PROFILE, roleFor, type HelpAction, type HelpContext, type HelpField, type HelpQuestion, type HelpUser } from "./contextualHelpCatalog";
import { clamp, isInsideHelp, rectFor, scanHelpContext } from "./contextualHelpDom";
import "./ContextualHelpSystem.css";

const EMPTY_CONTEXT: HelpContext = {
  path: "/",
  title: "ArtHello OS",
  section: "",
  profile: FALLBACK_PROFILE,
  fields: [],
  actions: [],
  errors: [],
  signature: "initial",
};

export function ContextualHelpSystem() {
  const [user, setUser] = useState<HelpUser | null>(null);
  const [open, setOpen] = useState(false);
  const [hints, setHints] = useState(true);
  const [question, setQuestion] = useState<HelpQuestion>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [tour, setTour] = useState(0);
  const [context, setContext] = useState<HelpContext>(EMPTY_CONTEXT);
  const ids = useRef(new WeakMap<HTMLElement, string>());
  const counter = useRef(0);
  const frame = useRef<number | null>(null);
  const pageKey = useRef("");

  const idFor = useCallback((element: HTMLElement, prefix: string) => {
    const existing = ids.current.get(element);
    if (existing) return existing;
    const id = `${prefix}-${++counter.current}`;
    ids.current.set(element, id);
    return id;
  }, []);

  const scan = useCallback(() => {
    if (!document.body) return;
    const next = scanHelpContext(idFor);
    const nextPageKey = `${next.path}\n${next.title}\n${next.section}`;
    if (pageKey.current && pageKey.current !== nextPageKey) {
      setQuestion("overview");
      setSelected(null);
      setTour(0);
    }
    pageKey.current = nextPageKey;
    setContext((current) => current.signature === next.signature ? current : next);
  }, [idFor]);

  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      scan();
    });
  }, [scan]);

  useEffect(() => {
    let hintTimer: number | undefined;
    try {
      if (localStorage.getItem("arthello.inline-help") === "0") {
        hintTimer = window.setTimeout(() => setHints(false), 0);
      }
    } catch {
      // The preference remains session-only when storage is unavailable.
    }
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as HelpUser : null)
      .then(setUser)
      .catch(() => setUser(null));
    return () => {
      if (hintTimer !== undefined) window.clearTimeout(hintTimer);
    };
  }, []);

  useEffect(() => {
    schedule();
    const observer = new MutationObserver((mutations) => {
      if (!mutations.every((mutation) => isInsideHelp(mutation.target))) schedule();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden", "aria-selected", "aria-current", "disabled", "aria-disabled", "aria-invalid"],
    });
    const update = () => schedule();
    const updateFromEvent = (event: Event) => {
      if (!isInsideHelp(event.target as Node)) schedule();
    };
    addEventListener("resize", update);
    addEventListener("scroll", update, true);
    addEventListener("popstate", update);
    document.addEventListener("focusin", updateFromEvent, true);
    document.addEventListener("input", updateFromEvent, true);
    document.addEventListener("change", updateFromEvent, true);
    return () => {
      observer.disconnect();
      removeEventListener("resize", update);
      removeEventListener("scroll", update, true);
      removeEventListener("popstate", update);
      document.removeEventListener("focusin", updateFromEvent, true);
      document.removeEventListener("input", updateFromEvent, true);
      document.removeEventListener("change", updateFromEvent, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [schedule]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);

  const createAction = useMemo(() => context.actions.find((item) => /добавить|создать|нов(ая|ый|ое)|пригласить|загрузить/i.test(item.label)), [context.actions]);
  const saveAction = useMemo(() => context.actions.find((item) => /сохранить|создать|добавить|подтвердить|отправить|применить/i.test(item.label)), [context.actions]);
  const disabledActions = useMemo(() => context.actions.filter((item) => item.disabled), [context.actions]);
  const problemFields = useMemo(() => context.fields.filter((item) => item.missing || item.invalid), [context.fields]);
  const tourTargets = useMemo(() => [
    ...context.fields,
    ...context.actions.filter((item) => /добавить|создать|сохранить|применить|отправить|подтвердить/i.test(item.label)),
  ], [context.fields, context.actions]);

  const target = useCallback((id: string | null) => {
    return context.fields.find((item) => item.id === id) || context.actions.find((item) => item.id === id);
  }, [context]);

  const show = useCallback((id: string) => {
    const item = target(id);
    if (!item) return;
    setSelected(id);
    item.element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    setTimeout(schedule, 260);
  }, [schedule, target]);

  const fieldHelp = useCallback((field: HelpField) => {
    setOpen(true);
    setQuestion(`field:${field.id}`);
    show(field.id);
  }, [show]);

  const setHintPreference = useCallback((value: boolean) => {
    setHints(value);
    try {
      localStorage.setItem("arthello.inline-help", value ? "1" : "0");
    } catch {
      // The preference remains active until the page is closed.
    }
  }, []);

  const moveTour = useCallback((index: number) => {
    const next = clamp(index, 0, Math.max(0, tourTargets.length - 1));
    setTour(next);
    if (tourTargets[next]) show(tourTargets[next].id);
  }, [show, tourTargets]);

  const startTour = useCallback(() => {
    setOpen(true);
    setQuestion("tour");
    moveTour(0);
  }, [moveTour]);

  const questions = useMemo(() => {
    const result: Array<{ key: HelpQuestion; label: string }> = [{ key: "overview", label: "Что здесь делать?" }];
    if (createAction) result.push({ key: "create", label: `Как выполнить «${createAction.label}»?` });
    if (context.fields.length) result.push({ key: "fields", label: "Что нужно заполнить на этой странице?" });
    context.fields.slice(0, 2).forEach((field) => result.push({ key: `field:${field.id}`, label: `Что означает поле «${field.label}»?` }));
    if (disabledActions.length) result.push({ key: "disabled", label: "Почему кнопка недоступна?" });
    if (saveAction) result.push({ key: "save", label: "Что произойдёт после сохранения?" });
    if (context.errors.length || problemFields.length) result.push({ key: "errors", label: "Как исправить ошибки?" });
    if (tourTargets.length) result.push({ key: "tour", label: "Показать всё пошагово" });
    return result;
  }, [context, createAction, disabledActions.length, problemFields.length, saveAction, tourTargets.length]);

  const answer = useMemo(() => {
    if (question.startsWith("field:")) {
      const field = context.fields.find((item) => item.id === question.slice(6));
      return field ? {
        title: field.label,
        paragraphs: [
          field.hint,
          `${field.required ? "Поле обязательно" : "Поле необязательно"}${field.missing ? " и сейчас не заполнено" : ""}.`,
          `После сохранения: ${field.effect}`,
        ],
        target: field as HelpField | HelpAction,
      } : null;
    }
    if (question === "overview") return {
      title: "Назначение страницы",
      paragraphs: [context.profile.purpose, `С чего начать: ${context.profile.first}`, `На странице обнаружено ${context.fields.length} полей и ${context.actions.length} действий.`],
    };
    if (question === "create") return {
      title: createAction ? `Действие «${createAction.label}»` : "Добавление записи",
      paragraphs: createAction ? ["Нажмите выделенную кнопку, заполните обязательные поля, проверьте связи и сохраните запись.", createAction.disabled ? createAction.reason : "Действие доступно вашей роли."] : ["На текущем экране нет доступной кнопки создания."],
      target: createAction,
    };
    if (question === "save") return {
      title: "Сохранение данных",
      paragraphs: [
        "После ответа сервера данные станут частью текущей карточки и будут доступны связанным разделам в пределах прав пользователей.",
        problemFields.length ? `Сначала исправьте проблемные поля: ${problemFields.slice(0, 5).map((field) => field.label).join(", ")}.` : "Явных незаполненных обязательных полей не обнаружено.",
        saveAction?.disabled ? saveAction.reason : "",
      ].filter(Boolean),
      target: saveAction,
    };
    if (question === "fields") return {
      title: "Поля страницы",
      paragraphs: context.fields.length ? context.fields.slice(0, 10).map((field) => `${field.label}: ${field.required ? "обязательно" : "необязательно"}${field.missing ? ", не заполнено" : ""}.`) : ["Видимых полей ввода нет."],
    };
    if (question === "disabled") return {
      title: "Недоступные действия",
      paragraphs: disabledActions.length ? disabledActions.slice(0, 8).map((item) => `${item.label}: ${item.reason}`) : ["Все видимые действия доступны."],
    };
    if (question === "errors") {
      const problems = [
        ...problemFields.slice(0, 8).map((field) => `${field.label}: ${field.missing ? "обязательное поле не заполнено" : "значение некорректно"}.`),
        ...context.errors,
      ];
      return { title: "Что исправить", paragraphs: problems.length ? problems : ["Видимых ошибок нет."] };
    }
    return null;
  }, [context, createAction, disabledActions, problemFields, question, saveAction]);

  const selectedTarget = target(selected);
  const spotlight = selectedTarget ? rectFor(selectedTarget.element) : null;
  const currentTour = tourTargets[tour];

  return (
    <div data-ah-help-root="true">
      {hints ? context.fields
        .filter((field) => field.rect.bottom > 0 && field.rect.right > 0 && field.rect.top < innerHeight && field.rect.left < innerWidth)
        .map((field) => {
          const width = clamp(field.rect.width, 168, 310);
          const left = clamp(field.rect.left, 8, Math.max(8, innerWidth - width - 8));
          const top = field.rect.top > 29 ? field.rect.top - 26 : field.rect.bottom + 4;
          return (
            <div className="ah-field" key={field.id} style={{ left, top, width }} title={`${field.label}: ${field.hint}`}>
              <span>{field.hint}</span>
              <button type="button" aria-label={`Помощь по полю «${field.label}»`} onClick={() => fieldHelp(field)}>?</button>
            </div>
          );
        }) : null}

      {spotlight ? <div className="ah-spot" aria-hidden="true" style={{ top: spotlight.top - 5, left: spotlight.left - 5, width: spotlight.width + 10, height: spotlight.height + 10 }} /> : null}

      {open ? (
        <section className="ah-panel" role="dialog" aria-modal="false" aria-label="Контекстная помощь ArtHello OS">
          <header className="ah-head">
            <div>
              <p className="ah-kicker">Помощь по текущей странице</p>
              <h2>{context.title || context.profile.title}</h2>
              <p className="ah-sub">Раздел: {context.profile.title} · Роль: {roleFor(user)}</p>
            </div>
            <button className="ah-close" type="button" aria-label="Закрыть помощь" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="ah-body">
            <div className="ah-page">
              <strong>Что здесь можно сделать</strong>
              <p>{context.profile.purpose}</p>
              <div className="ah-meta">
                <span className="ah-chip">{context.fields.length} полей</span>
                <span className="ah-chip">{context.actions.length} действий</span>
                {problemFields.length ? <span className="ah-chip">Исправить: {problemFields.length}</span> : null}
              </div>
            </div>
            <div className="ah-tools">
              <h3>Вопросы по этой странице</h3>
              <label className="ah-toggle">
                <input type="checkbox" checked={hints} onChange={(event: { currentTarget: HTMLInputElement }) => setHintPreference(event.currentTarget.checked)} />
                Подсказки над полями
              </label>
            </div>
            <div className="ah-list">
              {questions.map((item) => (
                <button className="ah-q" key={item.key} type="button" aria-pressed={question === item.key} onClick={() => {
                  if (item.key === "tour") startTour();
                  else {
                    setQuestion(item.key);
                    if (item.key.startsWith("field:")) show(item.key.slice(6));
                  }
                }}>{item.label}</button>
              ))}
            </div>
            {question === "tour" ? (
              <div className="ah-answer">
                <h4>Пошаговое обучение</h4>
                {currentTour ? (
                  <>
                    <p><strong>Шаг {tour + 1} из {tourTargets.length}: {currentTour.label}</strong></p>
                    <p>{"hint" in currentTour ? currentTour.hint : `Используйте действие «${currentTour.label}» после проверки обязательных данных.`}</p>
                    <div className="ah-actions">
                      <button className="ah-btn secondary" type="button" disabled={tour === 0} onClick={() => moveTour(tour - 1)}>Назад</button>
                      <button className="ah-btn" type="button" onClick={() => show(currentTour.id)}>Показать</button>
                      {tour < tourTargets.length - 1 ? <button className="ah-btn" type="button" onClick={() => moveTour(tour + 1)}>Далее</button> : <button className="ah-btn" type="button" onClick={() => { setQuestion("overview"); setSelected(null); }}>Завершить</button>}
                    </div>
                  </>
                ) : <p>На странице нет элементов для обучения.</p>}
              </div>
            ) : answer ? (
              <div className="ah-answer">
                <h4>{answer.title}</h4>
                {answer.paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph}`} className={/не заполн|некоррект|недоступ/.test(paragraph) ? "ah-warn" : ""}>{paragraph}</p>)}
                {answer.target ? <div className="ah-actions"><button className="ah-btn" type="button" onClick={() => show(answer.target!.id)}>Показать на странице</button></div> : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <button className="ah-launch" type="button" aria-expanded={open} aria-label={open ? "Закрыть помощь" : `Открыть помощь по разделу «${context.profile.title}»`} onClick={() => setOpen((value) => !value)}>
        <b aria-hidden="true">?</b><span>Помощь</span>
      </button>
    </div>
  );
}
