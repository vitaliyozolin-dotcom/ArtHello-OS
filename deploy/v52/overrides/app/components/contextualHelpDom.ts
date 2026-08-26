import { FIELD_RULES, profileFor, type HelpAction, type HelpContext, type HelpField, type HelpRect } from "./contextualHelpCatalog";

export function cleanText(value: string | null | undefined, max = 120) {
  const clean = (value || "").replace(/\s+/g, " ").replace(/^[*•·\-–—\s]+|[*•·\-–—\s]+$/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function isInsideHelp(node: Node | null) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
  return Boolean(element?.closest("[data-ah-help-root]"));
}

function isRendered(element: HTMLElement) {
  if (element.closest("[data-ah-help-root]")) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

export function rectFor(element: HTMLElement): HelpRect {
  const rect = element.getBoundingClientRect();
  return { top: Math.round(rect.top), left: Math.round(rect.left), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
}

function elementText(element?: HTMLElement) {
  if (!element) return "";
  if (element instanceof HTMLInputElement && ["submit", "button", "reset"].includes(element.type)) return cleanText(element.value);
  return cleanText(element.innerText || element.textContent || element.getAttribute("aria-label") || element.title);
}

function labelFor(element: HTMLElement) {
  const explicit = cleanText(element.getAttribute("data-help-title"), 80);
  if (explicit) return explicit;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const value = cleanText(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "), 80);
    if (value) return value;
  }
  if (element.id) {
    const label = Array.from(document.getElementsByTagName("label")).find((item) => item.htmlFor === element.id);
    const value = cleanText(label?.textContent, 80);
    if (value) return value;
  }
  const wrapped = cleanText(element.closest("label")?.textContent, 80);
  if (wrapped) return wrapped;
  const aria = cleanText(element.getAttribute("aria-label"), 80);
  if (aria) return aria;
  const placeholder = cleanText(element.getAttribute("placeholder"), 80);
  if (placeholder) return placeholder;
  const name = cleanText(element.getAttribute("name"), 80).replace(/[_-]+/g, " ");
  if (name) return name;
  if (element.getAttribute("role") === "combobox" || element instanceof HTMLSelectElement) return "Выбор значения";
  if (element instanceof HTMLTextAreaElement) return "Комментарий";
  if (element instanceof HTMLInputElement) {
    const labels: Record<string, string> = { date: "Дата", number: "Числовое значение", email: "Электронная почта", tel: "Телефон", password: "Пароль", file: "Файл", search: "Поиск" };
    if (labels[element.type]) return labels[element.type];
  }
  return "Поле ввода";
}

function hintFor(label: string, element: HTMLElement) {
  const explicit = cleanText(element.getAttribute("data-help-description"), 220);
  if (explicit) return explicit;
  const rule = FIELD_RULES.find(([pattern]) => pattern.test(label.toLowerCase()));
  if (rule) return rule[1];
  if (element instanceof HTMLSelectElement || element.getAttribute("role") === "combobox") return "Выберите подходящее значение из списка.";
  if (element instanceof HTMLTextAreaElement || element.hasAttribute("contenteditable")) return "Введите поясняющий текст для текущей карточки.";
  if (element instanceof HTMLInputElement && element.type === "checkbox") return "Включите параметр, только если условие действительно выполняется.";
  return "Заполните поле данными, относящимися к текущей карточке.";
}

function effectFor(label: string, element: HTMLElement) {
  const explicit = cleanText(element.getAttribute("data-help-effect"), 220);
  if (explicit) return explicit;
  const rule = FIELD_RULES.find(([pattern]) => pattern.test(label.toLowerCase()));
  return rule?.[2] || "Значение станет частью текущей записи и будет использоваться в связанных разделах.";
}

function isRequired(element: HTMLElement) {
  return element.hasAttribute("required") || element.getAttribute("aria-required") === "true" || element.getAttribute("data-required") === "true" || element.getAttribute("data-help-required") === "true";
}

function isEmpty(element: HTMLElement) {
  if (element instanceof HTMLInputElement) {
    if (["checkbox", "radio"].includes(element.type)) return !element.checked;
    if (element.type === "file") return !element.files?.length;
    return !element.value.trim();
  }
  if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return !element.value.trim();
  if (element.getAttribute("role") === "combobox") return !cleanText(element.getAttribute("aria-valuetext") || element.textContent);
  return element.hasAttribute("contenteditable") ? !cleanText(element.textContent) : false;
}

function isInvalid(element: HTMLElement) {
  if (element.getAttribute("aria-invalid") === "true" || element.getAttribute("data-invalid") === "true") return true;
  try { return element.matches(":invalid"); } catch { return false; }
}

function isDisabled(element: HTMLElement) {
  return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" || element.getAttribute("data-disabled") === "true";
}

export function scanHelpContext(idFor: (element: HTMLElement, prefix: string) => string): HelpContext {
  const heading = Array.from(document.querySelectorAll<HTMLElement>("[data-page-title],main h1,main h2,h1,[role=heading][aria-level='1']")).find(isRendered);
  const title = cleanText(heading?.getAttribute("data-page-title") || heading?.innerText || document.title || "ArtHello OS", 100);
  const active = Array.from(document.querySelectorAll<HTMLElement>("[aria-current=page],[data-active=true],nav .active,aside .active,[role=tab][aria-selected=true]")).find(isRendered);
  const section = elementText(active).slice(0, 90);
  const path = location.pathname || "/";
  const profile = profileFor(`${path} ${title} ${section} ${document.title}`);

  Array.from(document.querySelectorAll<HTMLElement>("nav a,nav button,aside a,aside button,[role=menuitem],[role=tab]"))
    .filter(isRendered)
    .forEach((item) => {
      const label = elementText(item);
      if (!label || item.title || item.dataset.ahHelpMenu === "1") return;
      const target = profileFor(label);
      item.title = target.id === "generic" ? `Открыть раздел «${label}».` : `Открыть раздел «${label}». ${target.purpose}`;
      item.dataset.ahHelpMenu = "1";
    });

  const fields = Array.from(document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),select,textarea,[role=combobox],[contenteditable]:not([contenteditable=false])"))
    .filter(isRendered).slice(0, 80).map<HelpField>((element) => {
      const label = labelFor(element);
      const required = isRequired(element);
      return { id: idFor(element, "field"), element, label, hint: hintFor(label, element), effect: effectFor(label, element), required, missing: required && isEmpty(element), invalid: isInvalid(element), disabled: isDisabled(element), rect: rectFor(element) };
    });

  const missing = fields.filter((field) => field.missing).map((field) => field.label);
  const actions = Array.from(document.querySelectorAll<HTMLElement>("button,[role=button],input[type=submit],input[type=button]"))
    .filter((element) => isRendered(element) && !element.closest("[data-ah-help-root]")).slice(0, 100)
    .map<HelpAction | null>((element) => {
      const label = elementText(element);
      if (!label) return null;
      const disabled = isDisabled(element);
      const explicit = cleanText(element.getAttribute("data-help-disabled-reason"), 200);
      const reason = explicit || (disabled && missing.length ? `Не заполнены обязательные поля: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " и другие" : ""}.` : disabled ? "Действие недоступно из-за состояния записи или прав вашей роли." : "");
      return { id: idFor(element, "action"), element, label, disabled, reason, rect: rectFor(element) };
    }).filter((item): item is HelpAction => Boolean(item));

  const errors = Array.from(new Set(Array.from(document.querySelectorAll<HTMLElement>("[role=alert],[aria-live=assertive],[data-error],.field-error,.form-error")).filter(isRendered).map(elementText).filter(Boolean))).slice(0, 8);
  const signature = JSON.stringify({ path, title, section, profile: profile.id, fields: fields.map((field) => [field.id, field.label, field.required, field.missing, field.invalid, field.disabled, field.rect]), actions: actions.map((action) => [action.id, action.label, action.disabled, action.rect]), errors });
  return { path, title, section, profile, fields, actions, errors, signature };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
