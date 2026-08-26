import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../app/components/OwnerDashboard.tsx", import.meta.url));
let source = readFileSync(target, "utf8");

function replaceOnce(search, replacement, label) {
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1 || second !== -1) {
    throw new Error(`Dashboard personalization patch failed at ${label}`);
  }
  source = `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

replaceOnce(
  'const kpiIcons = ["finance", "sales", "legal", "clients", "registry", "hr"] as const;\n',
  `const kpiIcons = ["finance", "sales", "legal", "clients", "registry", "hr"] as const;\n\nconst MOSCOW_TIME_ZONE = "Europe/Moscow";\n\nfunction moscowHour(value: Date) {\n  const hour = new Intl.DateTimeFormat("ru-RU", {\n    timeZone: MOSCOW_TIME_ZONE,\n    hour: "2-digit",\n    hourCycle: "h23",\n  }).formatToParts(value).find((part) => part.type === "hour")?.value;\n  return Number(hour ?? 0);\n}\n\nfunction greetingForMoscow(value: Date) {\n  const hour = moscowHour(value);\n  if (hour < 5) return "Доброй ночи";\n  if (hour < 12) return "Доброе утро";\n  if (hour < 18) return "Добрый день";\n  if (hour < 23) return "Добрый вечер";\n  return "Доброй ночи";\n}\n\nfunction dashboardDateForMoscow(value: Date) {\n  return new Intl.DateTimeFormat("ru-RU", {\n    timeZone: MOSCOW_TIME_ZONE,\n    weekday: "long",\n    day: "numeric",\n    month: "long",\n    year: "numeric",\n  }).format(value).replace(/^./, (letter) => letter.toUpperCase());\n}\n`,
  "Moscow helpers",
);

replaceOnce(
  '  const [activeChartIndex, setActiveChartIndex] = useState<number | null>(null);\n\n  useEffect(() => {',
  `  const [activeChartIndex, setActiveChartIndex] = useState<number | null>(null);\n  const [now, setNow] = useState(() => new Date());\n\n  useEffect(() => {\n    const updateClock = () => setNow(new Date());\n    const timer = window.setInterval(updateClock, 60_000);\n    const onVisibilityChange = () => {\n      if (document.visibilityState === "visible") updateClock();\n    };\n    document.addEventListener("visibilitychange", onVisibilityChange);\n    return () => {\n      window.clearInterval(timer);\n      document.removeEventListener("visibilitychange", onVisibilityChange);\n    };\n  }, []);\n\n  useEffect(() => {`,
  "live Moscow clock",
);

replaceOnce(
  '  const firstName = displayName.split(" ")[0] || "Виталий";\n',
  `  const firstName = displayName.trim().split(/\\s+/)[0] || "Пользователь";\n  const greeting = greetingForMoscow(now);\n  const dashboardDate = dashboardDateForMoscow(now);\n`,
  "authenticated first name",
);

replaceOnce(
  '          <h1>Доброе утро, {firstName}!</h1>\n',
  '          <h1>{greeting}, {firstName}!</h1>\n',
  "greeting text",
);

replaceOnce(
  '          <p>{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()).replace(/^./, (letter) => letter.toUpperCase())}</p>\n',
  '          <p>{dashboardDate}</p>\n',
  "Moscow date",
);

writeFileSync(target, source, "utf8");
console.log("Dashboard personalization patch applied");
