import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@workspace/api-client-react";
import {
  PLAN_METRICS,
  currentPlanMonth,
  parsePlanInput,
  parsePlanTarget,
  planCompletion,
  type MonthlyPlan,
  type PlanInput,
  type PlanMetric,
  type PulsePlanResponse,
} from "@workspace/shared/pulse-plan";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";

const LABELS: Record<PlanMetric, string> = {
  leads: "Лиды",
  students: "Новые ученики",
  payments: "Количество оплат",
  receiptsMinor: "Поступления, ₽",
};
const emptyFields = (): Record<PlanMetric, string> => ({
  leads: "",
  students: "",
  payments: "",
  receiptsMinor: "",
});
const formatValue = (metric: PlanMetric, value: number) =>
  new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: metric === "receiptsMinor" ? 2 : 0,
  }).format(metric === "receiptsMinor" ? value / 100 : value);
const buttonClass =
  "min-h-[44px] rounded-[16px] px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50";

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Не удалось загрузить или сохранить план");
  }
  return response.json() as Promise<T>;
}

export function MonthlyPlanSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentPlanMonth);
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(emptyFields);
  const [revision, setRevision] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const queryKey = ["monthly-plan", month];
  const query = useQuery({
    queryKey,
    queryFn: async () =>
      responseJson<PulsePlanResponse>(
        await apiFetch(
          `/api/finance/monthly-plan?month=${encodeURIComponent(month)}`,
        ),
      ),
  });
  const save = useMutation({
    mutationFn: async (input: PlanInput) =>
      responseJson<MonthlyPlan>(
        await apiFetch("/api/finance/monthly-plan", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setOpen(false);
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  function startEditing() {
    const targets = query.data?.plan?.targets;
    const next = emptyFields();
    for (const metric of PLAN_METRICS) {
      const value = targets?.[metric];
      next[metric] =
        value == null
          ? ""
          : metric === "receiptsMinor"
            ? `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`
            : String(value);
    }
    setFields(next);
    setRevision(query.data?.plan?.revision ?? 0);
    setValidationError(null);
    save.reset();
    setOpen(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const targets = Object.fromEntries(
        PLAN_METRICS.map((metric) => [
          metric,
          parsePlanTarget(metric, fields[metric]),
        ]),
      ) as PlanInput["targets"];
      const input = parsePlanInput({ month, revision, targets });
      setValidationError(null);
      save.mutate(input);
    } catch (error) {
      setValidationError((error as Error).message);
    }
  }

  return (
    <section
      className="rounded-[28px] border border-border bg-card p-5 sm:p-6"
      aria-labelledby="monthly-plan-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3
            id="monthly-plan-title"
            className="text-[17px] font-bold text-foreground"
          >
            План / Факт
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Вся организация · месяц по московскому времени
          </p>
        </div>
        <label className="text-xs text-muted-foreground">
          Месяц
          <input
            aria-label="Месяц плана"
            type="month"
            min="2000-01"
            max="2099-12"
            value={month}
            disabled={save.isPending || open}
            onChange={(event) => {
              if (event.target.value) setMonth(event.target.value);
            }}
            className="block min-h-[44px] max-w-full rounded-[16px] border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
      </div>
      {query.isPending ? (
        <p role="status">Загрузка плана…</p>
      ) : query.isError ? (
        <div role="alert" className="text-sm text-destructive">
          <p>{query.error.message}</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="min-h-[44px] underline"
          >
            Повторить загрузку
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-sm text-muted-foreground">
              {query.data.plan ? "Месячный план сохранён" : "План не настроен"}
            </p>
            {user?.role === "owner" && (
              <button
                type="button"
                onClick={startEditing}
                className={buttonClass}
              >
                {query.data.plan ? "Изменить план" : "Настроить план"}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {PLAN_METRICS.map((metric) => {
              const plan = query.data.plan?.targets[metric] ?? null;
              const fact = query.data.facts[metric];
              const pct = planCompletion(fact, plan);
              return (
                <div
                  key={metric}
                  className="border-b border-border pb-3 last:border-0"
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{LABELS[metric]}</span>
                    <span>{pct == null ? "—" : `${pct}%`}</span>
                  </div>
                  <div
                    className="mt-2 h-1.5 rounded-full bg-background overflow-hidden"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Факт:{" "}
                    {fact == null
                      ? "не подтверждено"
                      : formatValue(metric, fact)}{" "}
                    · План:{" "}
                    {plan == null ? "не задан" : formatValue(metric, plan)}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Факт по лидам — зарегистрированные события за месяц без отмеченных
            кандидатов в дубли. Полнота источника не подтверждена. Месячные
            факты учеников, оплат и поступлений пока не подключены.
          </p>
          {query.data.plan && (
            <p className="mt-2 text-xs text-muted-foreground">
              Обновлён:{" "}
              {new Date(query.data.plan.updatedAt).toLocaleString("ru-RU", {
                timeZone: "Europe/Moscow",
              })}{" "}
              · версия {query.data.plan.revision}
            </p>
          )}
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!save.isPending) setOpen(value);
        }}
      >
        <DialogContent className="w-[calc(100%-2rem)] max-h-[90dvh] overflow-y-auto rounded-[28px]">
          <DialogHeader>
            <DialogTitle>План на {month}</DialogTitle>
            <DialogDescription>
              Вся организация. Пустое поле — цель не задана. Ноль — заданная
              нулевая цель.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {PLAN_METRICS.map((metric) => (
              <label key={metric} className="block text-sm font-medium">
                {LABELS[metric]}
                <input
                  type="text"
                  inputMode={metric === "receiptsMinor" ? "decimal" : "numeric"}
                  value={fields[metric]}
                  disabled={save.isPending}
                  onChange={(event) =>
                    setFields((previous) => ({
                      ...previous,
                      [metric]: event.target.value,
                    }))
                  }
                  className="mt-1 block w-full min-h-[44px] rounded-[16px] border border-border bg-background px-3"
                />
              </label>
            ))}
            {(validationError || save.error) && (
              <p role="alert" className="text-sm text-destructive">
                {validationError ?? save.error?.message}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => setOpen(false)}
                className="min-h-[44px] px-3"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={save.isPending}
                className={buttonClass}
              >
                {save.isPending ? "Сохранение…" : "Сохранить план"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
