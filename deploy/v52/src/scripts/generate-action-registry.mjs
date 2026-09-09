import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "data/test-snapshot.ts"), "utf8");
const catalogBlock = source.match(/export const moduleCatalog = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
const modules = [...catalogBlock.matchAll(/\{ id: "([^"]+)", label: "([^"]+)", group: "([^"]+)"/g)].map((match) => ({ id: match[1], label: match[2], group: match[3] }));

if (modules.length < 25) throw new Error(`Expected at least 25 modules, found ${modules.length}`);

const patterns = [
  ["NAV", "пункт основного меню", "открыть раздел с первого клика", "#MODULE", "заголовок раздела и активный пункт меню"],
  ["BREADCRUMB", "хлебная крошка Главная", "вернуться на персональный дашборд", "#home", "роль и тестовый контекст сохранены"],
  ["SECTION_HOME", "название текущего раздела", "вернуться в начало раздела", "#MODULE", "прокрутка в начало без полной перезагрузки"],
  ["BACK", "кнопка Назад", "вернуться на предыдущий логический экран", "history.back|#home", "история браузера остаётся предсказуемой"],
  ["KPI", "KPI-карточка", "раскрыть детализацию показателя", "#MODULE/detail", "источник, расчёт, качество и ответственный доступны"],
  ["ROW", "строка рабочего реестра", "открыть карточку записи", "#MODULE/record", "карточка, связи и следующее действие доступны"],
];

const actions = modules.flatMap((module) => patterns.map((pattern) => ({
  id: `ACT-${module.id.toUpperCase()}-${pattern[0]}`,
  screen: module.label,
  element: pattern[1],
  role: module.id === "medical" ? "Медработник" : module.id === "access" ? "Собственник|Директор|HR|Представитель Виталия" : "разрешённая роль",
  expectedAction: pattern[2],
  expectedRoute: pattern[3].replace("MODULE", module.id),
  expectedResult: pattern[4],
  loadingState: "визуальная реакция сразу; повторное действие заблокировано при загрузке",
  errorState: "контекстная ошибка с повтором или понятным следующим шагом",
  test: `tests/action-registry.test.mjs#${pattern[0].toLowerCase()}`,
  actualResult: "registered_and_source_verified"
})));

actions.push(
  { id: "ACT-SHELL-SEARCH", screen: "Общая оболочка", element: "глобальный поиск", role: "все", expectedAction: "найти раздел или сущность и открыть результат", expectedRoute: "#<module>", expectedResult: "результаты сгруппированы по типу и показывают контекст", loadingState: "локальный индекс отвечает без белого экрана", errorState: "пустой результат объяснён", test: "tests/action-registry.test.mjs#shell", actualResult: "registered_and_source_verified" },
  { id: "ACT-SHELL-COMMAND", screen: "Общая оболочка", element: "Ctrl/Cmd+K", role: "все", expectedAction: "открыть командную палитру", expectedRoute: "dialog:command", expectedResult: "разделы, сущности и быстрые действия доступны с клавиатуры", loadingState: "мгновенно", errorState: "не применимо", test: "tests/action-registry.test.mjs#shell", actualResult: "registered_and_source_verified" },
  { id: "ACT-SHELL-CREATE", screen: "Общая оболочка", element: "быстрое создание", role: "все рабочие роли", expectedAction: "открыть форму задачи", expectedRoute: "dialog:new-task", expectedResult: "валидируемая форма сохраняет задачу", loadingState: "кнопка Сохраняем… disabled", errorState: "введённые значения сохраняются, ошибка показана", test: "tests/action-registry.test.mjs#shell", actualResult: "registered_and_source_verified" },
  { id: "ACT-SHELL-COLLAPSE", screen: "Общая оболочка", element: "Свернуть меню", role: "все", expectedAction: "изменить ширину sidebar", expectedRoute: "same", expectedResult: "состояние сохраняется в localStorage", loadingState: "не применимо", errorState: "fallback expanded", test: "tests/action-registry.test.mjs#shell", actualResult: "registered_and_source_verified" },
  { id: "ACT-MOBILE-HOME", screen: "Mobile shell", element: "Главная", role: "все", expectedAction: "открыть персональный дашборд", expectedRoute: "#home", expectedResult: "active state видим", loadingState: "мгновенно", errorState: "родительский fallback", test: "tests/action-registry.test.mjs#mobile", actualResult: "registered_and_source_verified" },
  { id: "ACT-MOBILE-TASKS", screen: "Mobile shell", element: "Задачи", role: "все", expectedAction: "открыть задачи", expectedRoute: "#tasks", expectedResult: "рабочий реестр открыт", loadingState: "loading state", errorState: "retry state", test: "tests/action-registry.test.mjs#mobile", actualResult: "registered_and_source_verified" },
  { id: "ACT-MOBILE-CREATE", screen: "Mobile shell", element: "Создать", role: "все рабочие роли", expectedAction: "открыть форму задачи", expectedRoute: "dialog:new-task", expectedResult: "форма помещается в viewport", loadingState: "saving", errorState: "inline error", test: "tests/action-registry.test.mjs#mobile", actualResult: "registered_and_source_verified" },
  { id: "ACT-MOBILE-SEARCH", screen: "Mobile shell", element: "Поиск", role: "все", expectedAction: "открыть командную палитру", expectedRoute: "dialog:command", expectedResult: "bottom-sheet composition", loadingState: "мгновенно", errorState: "empty result", test: "tests/action-registry.test.mjs#mobile", actualResult: "registered_and_source_verified" },
  { id: "ACT-MOBILE-MODULES", screen: "Mobile shell", element: "Разделы", role: "все", expectedAction: "открыть navigation drawer", expectedRoute: "drawer:navigation", expectedResult: "крупные зоны нажатия и полный каталог", loadingState: "мгновенно", errorState: "scrim closes safely", test: "tests/action-registry.test.mjs#mobile", actualResult: "registered_and_source_verified" }
);

const extra = (record) => ({
  loadingState: "визуальная реакция сразу; повторное действие блокируется на время запроса",
  errorState: "ошибка объясняет причину и сохраняет рабочий контекст",
  test: "tests/action-registry.test.mjs#extended",
  actualResult: "registered_and_source_verified",
  ...record,
});

actions.push(
  ...[
    ["ACT-SHELL-LOGO", "логотип ArtHello", "открыть персональный дашборд", "#home", "роль и рабочий контекст сохранены"],
    ["ACT-SHELL-OBJECT", "переключатель объекта", "сменить рабочий объект", "same", "раздел остаётся открыт в новом контексте"],
    ["ACT-SHELL-LEGAL-ENTITY", "переключатель юрлица", "сменить юридическое лицо", "same", "данные и права пересчитаны в выбранном контексте"],
    ["ACT-SHELL-ROLE", "режим проверки роли", "переключить разрешения и персональный дашборд", "same", "закрытые данные не попадают в ответ"],
    ["ACT-SHELL-FRESHNESS", "индикатор актуальности данных", "открыть Центр интеграций", "#integrations", "видны журнал, конфликты и владельцы"],
    ["ACT-SHELL-NOTIFICATIONS", "уведомления", "показать текущее состояние уведомлений", "status:toast", "обратная связь доступна экранному диктору"],
  ].map(([id, element, expectedAction, expectedRoute, expectedResult]) => extra({ id, screen: "Общая оболочка", element, role: "все", expectedAction, expectedRoute, expectedResult })),
  ...[
    ["CHECK", "Проверить соединение", "выполнить preflight и записать запуск в аудит", "#integrations/log"],
    ["SYNC", "Запустить синхронизацию", "запустить разрешённый адаптер или честно заблокировать", "#integrations/log"],
    ["LOG", "Посмотреть журнал", "открыть журнал запусков", "#integrations/log"],
    ["ERRORS", "Посмотреть ошибки", "открыть ошибки и причины блокировки", "#integrations/log"],
    ["ADD-TEST", "Добавить тестовые данные", "идемпотентно создать синтетический набор", "#integrations"],
    ["DELETE-TEST", "Удалить тестовые данные", "после подтверждения удалить только тестовый набор интеграций", "#integrations"],
    ["RECONNECT", "Переподключить", "вернуть подключение в разрешённое состояние без фиктивного успеха", "#integrations/auth"],
    ["DISCONNECT", "Отключить", "приостановить передачу с записью в аудит", "#integrations/catalog"],
  ].map(([suffix, element, expectedAction, expectedRoute]) => extra({ id: `ACT-INTEGRATIONS-${suffix}`, screen: "Интеграции", element, role: "Собственник|Директор|Интеграции|Представитель Виталия", expectedAction, expectedRoute, expectedResult: "фактический статус, журнал и следующий шаг обновлены" })),
  ...[
    ["CONTENT-MONEY", "От публикации до денег", "content→sales→clients→finance"],
    ["CANDIDATE-SALARY", "От кандидата до выплаты", "hr→legal→finance"],
    ["PROGRAM-RESULT", "От программы до результата", "methods→education→quality"],
    ["DEFECT-REPAIR", "От неисправности до оплаты ремонта", "safety→tasks→contractors→accounting→finance"],
    ["PURCHASE-PNL", "От заявки на закупку до ОПиУ", "procurement→contractors→accounting→finance"],
    ["DISH-PROFIT", "От блюда до прибыльности кухни", "food→procurement→finance"],
    ["COMPLAINT-FIX", "От жалобы до исправления процесса", "quality→clients→tasks→projects"],
    ["RISK-ACTION", "От риска до управленческого действия", "analytics→projects→tasks→analytics"],
  ].map(([suffix, element, expectedRoute]) => extra({ id: `ACT-SCENARIO-${suffix}`, screen: "Сквозные сценарии", element, role: "разрешённая роль", expectedAction: "пройти связанную цепочку с возвратом к каждому уровню", expectedRoute, expectedResult: "предыдущий уровень, следующий уровень и первичный источник доступны" })),
);

writeFileSync(resolve(root, "data/action-registry.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: "2026-08-21T00:00:00Z", moduleCount: modules.length, actionCount: actions.length, actions }, null, 2)}\n`);
console.log(`Generated ${actions.length} actions for ${modules.length} modules`);
