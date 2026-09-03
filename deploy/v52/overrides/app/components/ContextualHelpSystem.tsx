"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FALLBACK_PROFILE,
  guideFor,
  roleFor,
  type HelpContext,
  type HelpGuide,
  type HelpGuideStep,
  type HelpRect,
  type HelpUser,
} from "./contextualHelpCatalog";
import {
  activeHelpScope,
  clamp,
  cleanText,
  findInHelpScope,
  isInsideHelp,
  isRendered,
  rectFor,
  scanHelpContext,
} from "./contextualHelpDom";
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

type RuntimeStep = HelpGuideStep & { element?: HTMLElement };
type TourState = {
  title: string;
  steps: RuntimeStep[];
  index: number;
  restoreTabLabel: string;
  single: boolean;
};

function selectedTabLabel() {
  const scope = activeHelpScope();
  const selected = Array.from(scope.querySelectorAll<HTMLElement>("[role=tab][aria-selected=true]"))
    .find(isRendered);
  return cleanText(selected?.textContent, 80);
}

function genericGuide(context: HelpContext): HelpGuide {
  const steps: HelpGuideStep[] = [
    {
      id: `${context.profile.id}-overview`,
      selector: "[data-page-title],h1,[role=heading][aria-level='1']",
      title: context.title || context.profile.title,
      text: context.profile.purpose,
      can: context.profile.first,
      cannot: "Действия, скрытые или заблокированные вашей ролью, не должны выполняться через помощника.",
    },
  ];

  if (context.section) {
    steps.push({
      id: `${context.profile.id}-tabs`,
      selector: "[role=tablist]",
      title: `Вкладка «${context.section}»`,
      text: "Вкладки разделяют разные процессы внутри раздела. Помощник учитывает только открытую вкладку и реально видимые элементы.",
      can: "Переключаться между доступными вкладками и работать с данными текущей области.",
      cannot: "Ожидать, что скрытая вкладка или недоступное вашей роли действие будет выполнено автоматически.",
    });
  }

  steps.push({
    id: `${context.profile.id}-workspace`,
    selector: "form,article,[class*='panel'],[class*='workspace']",
    title: "Рабочая область",
      text: "Здесь находятся данные, поля и действия текущей страницы. Подробное объяснение раздела всегда доступно через кнопку «Помощь».",
    can: "Заполнять видимые поля и использовать доступные кнопки после проверки данных.",
    cannot: "Сохранять случайные значения или обходить ограничения роли и обязательные проверки.",
  });

  return {
    id: context.profile.id,
    title: context.profile.title,
    intro: "Покажу назначение текущей страницы и её рабочие блоки без большого окна поверх интерфейса.",
    steps,
  };
}

export function ContextualHelpSystem() {
  const [user, setUser] = useState<HelpUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [context, setContext] = useState<HelpContext>(EMPTY_CONTEXT);
  const [tour, setTour] = useState<TourState | null>(null);
  const [tourRect, setTourRect] = useState<HelpRect | null>(null);
  const ids = useRef(new WeakMap<HTMLElement, string>());
  const counter = useRef(0);
  const frame = useRef<number | null>(null);
  const pageKey = useRef("");
  const tourElement = useRef<HTMLElement | null>(null);

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
    const nextPageKey = `${next.path}\n${next.title}`;
    if (pageKey.current && pageKey.current !== nextPageKey) {
      setMenuOpen(false);
      setTour(null);
      setTourRect(null);
      tourElement.current = null;
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
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as HelpUser : null)
      .then(setUser)
      .catch(() => setUser(null));
    return () => {
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
    addEventListener("hashchange", update);
    document.addEventListener("focusin", updateFromEvent, true);
    document.addEventListener("input", updateFromEvent, true);
    document.addEventListener("change", updateFromEvent, true);
    return () => {
      observer.disconnect();
      removeEventListener("resize", update);
      removeEventListener("scroll", update, true);
      removeEventListener("popstate", update);
      removeEventListener("hashchange", update);
      document.removeEventListener("focusin", updateFromEvent, true);
      document.removeEventListener("input", updateFromEvent, true);
      document.removeEventListener("change", updateFromEvent, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [schedule]);

  const clickTab = useCallback((label: string) => {
    if (!label) return null;
    const scope = activeHelpScope();
    const tab = Array.from(scope.querySelectorAll<HTMLElement>("[role=tab]"))
      .find((item) => isRendered(item) && cleanText(item.textContent, 80) === label);
    if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
    return tab ?? null;
  }, []);

  const closeTour = useCallback((restore = true) => {
    const restoreTabLabel = tour?.restoreTabLabel ?? "";
    setTour(null);
    setTourRect(null);
    tourElement.current = null;
    if (restore && restoreTabLabel) {
      window.setTimeout(() => {
        clickTab(restoreTabLabel);
        schedule();
      }, 70);
    }
  }, [clickTab, schedule, tour?.restoreTabLabel]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (tour) closeTour();
      else setMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [closeTour, tour]);

  const guide = useMemo(() => guideFor(context.profile.id) ?? genericGuide(context), [context]);

  const startGuide = useCallback((mode: "current" | "full") => {
    const activeTab = selectedTabLabel();
    let steps: RuntimeStep[] = guide.steps;
    if (mode === "current") {
      const matching = activeTab ? guide.steps.filter((step) => step.tabLabel === activeTab) : [];
      steps = matching.length ? matching : guide.steps.slice(0, 1);
    }
    if (!steps.length) return;
    setMenuOpen(false);
    setTour({ title: guide.title, steps, index: 0, restoreTabLabel: activeTab, single: mode === "current" && steps.length === 1 });
  }, [guide]);

  const moveTour = useCallback((index: number) => {
    setTour((current) => current ? { ...current, index: clamp(index, 0, Math.max(0, current.steps.length - 1)) } : current);
  }, []);

  const step = tour?.steps[tour.index];

  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    const timers: number[] = [];

    const measure = () => {
      const element = tourElement.current;
      if (!cancelled && element && document.contains(element) && isRendered(element)) setTourRect(rectFor(element));
    };

    const locate = (attempt: number) => {
      if (cancelled) return;
      const element = step.element && document.contains(step.element) && isRendered(step.element)
        ? step.element
        : step.selector
          ? findInHelpScope(step.selector)
          : null;

      if (!element && attempt < 7) {
        timers.push(window.setTimeout(() => locate(attempt + 1), 110));
        return;
      }

      tourElement.current = element;
      if (!element) {
        setTourRect(null);
        return;
      }

      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const rect = element.getBoundingClientRect();
      if (rect.top < 96 || rect.bottom > viewportHeight - 150) {
        element.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
      }
      timers.push(window.setTimeout(measure, 80));
    };

    const begin = () => {
      if (step.tabLabel) clickTab(step.tabLabel);
      timers.push(window.setTimeout(() => locate(0), step.tabLabel ? 150 : 20));
    };

    timers.push(window.setTimeout(begin, 0));
    addEventListener("resize", measure);
    addEventListener("scroll", measure, true);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      removeEventListener("resize", measure);
      removeEventListener("scroll", measure, true);
      tourElement.current = null;
    };
  }, [clickTab, step]);

  const calloutStyle = useMemo(() => {
    if (typeof window === "undefined") return { width: 360, left: 16, top: 120 };
    const width = Math.min(370, window.innerWidth - 24);
    const estimatedHeight = window.innerWidth <= 720 ? 245 : 225;
    const safeBottom = window.innerWidth <= 720 ? 104 : 16;
    if (!tourRect) return {
      width,
      left: Math.max(12, (window.innerWidth - width) / 2),
      top: Math.max(12, window.innerHeight - estimatedHeight - safeBottom),
    };

    const below = tourRect.bottom + 14;
    const belowFits = below + estimatedHeight <= window.innerHeight - safeBottom;
    const above = tourRect.top - estimatedHeight - 14;
    const top = belowFits ? below : above >= 12 ? above : Math.max(12, window.innerHeight - estimatedHeight - safeBottom);
    const left = clamp(tourRect.left, 12, Math.max(12, window.innerWidth - width - 12));
    return { width, left, top };
  }, [tourRect]);

  const holeStyle = useMemo(() => {
    if (!tourRect || typeof window === "undefined") return null;
    const padding = 6;
    const top = clamp(tourRect.top - padding, 6, Math.max(6, window.innerHeight - 18));
    const left = clamp(tourRect.left - padding, 6, Math.max(6, window.innerWidth - 18));
    const right = clamp(tourRect.right + padding, left + 12, window.innerWidth - 6);
    const bottom = clamp(tourRect.bottom + padding, top + 12, window.innerHeight - 6);
    return { top, left, width: right - left, height: bottom - top };
  }, [tourRect]);

  return (
    <div data-ah-help-root="true">
      {menuOpen && !tour ? (
        <aside className="ah-menu" role="dialog" aria-modal="false" aria-label="Помощь по текущей странице">
          <header>
            <div>
              <span>Помощь по текущей странице</span>
              <strong>{context.title || context.profile.title}</strong>
              <small>{context.section ? `${context.section} · ` : ""}{roleFor(user)}</small>
            </div>
            <button type="button" aria-label="Закрыть помощь" onClick={() => setMenuOpen(false)}>×</button>
          </header>
          <p>{guide.intro}</p>
          <div className="ah-menu-actions">
            <button className="primary" type="button" onClick={() => startGuide("current")}>Объяснить текущую вкладку</button>
            <button type="button" onClick={() => startGuide("full")}>Пройти обучение по разделу</button>
          </div>
        </aside>
      ) : null}

      {tour && step ? (
        <>
          <button className="ah-tour-blocker" type="button" aria-label="Закрыть обучение" onClick={() => closeTour()} />
          {holeStyle ? <div className="ah-tour-hole" aria-hidden="true" style={holeStyle} /> : null}
          <section className="ah-tour-callout" style={calloutStyle} role="status" aria-live="polite">
            <div className="ah-tour-progress">
              <span>{tour.single ? "Подсказка" : `Шаг ${tour.index + 1} из ${tour.steps.length}`}</span>
              <button type="button" aria-label="Закрыть обучение" onClick={() => closeTour()}>×</button>
            </div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
            {step.can ? <div className="ah-tour-rule can"><strong>Можно</strong><span>{step.can}</span></div> : null}
            {step.cannot ? <div className="ah-tour-rule cannot"><strong>Нельзя</strong><span>{step.cannot}</span></div> : null}
            {!tourRect ? <small className="ah-tour-searching">Ищу соответствующий блок на странице…</small> : null}
            <div className="ah-tour-actions">
              {!tour.single ? <button type="button" disabled={tour.index === 0} onClick={() => moveTour(tour.index - 1)}>Назад</button> : null}
              {tour.single ? (
                <button className="primary" type="button" onClick={() => closeTour()}>Понятно</button>
              ) : tour.index < tour.steps.length - 1 ? (
                <button className="primary" type="button" onClick={() => moveTour(tour.index + 1)}>Дальше</button>
              ) : (
                <button className="primary" type="button" onClick={() => closeTour()}>Завершить</button>
              )}
            </div>
          </section>
        </>
      ) : null}

      {!tour ? (
        <button
          className="ah-launch"
          type="button"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Закрыть помощь" : `Открыть помощь по разделу «${context.profile.title}»`}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <b aria-hidden="true">i</b><span>Помощь</span>
        </button>
      ) : null}
    </div>
  );
}
