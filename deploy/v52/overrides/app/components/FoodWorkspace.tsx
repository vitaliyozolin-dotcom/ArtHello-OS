"use client";

import { useCallback, useEffect, useState } from "react";
import { humanTechnicalText, recordLabel, recordNumber, taskRecordLabel } from "../../lib/record-labels";
import {
  Button,
  Card,
  CompactListCard,
  EmptyState,
  KpiCard,
  PageContainer,
  PageHeader,
  Tabs,
} from "./design-system";
import "./FoodWorkspace.ds.css";

type Data = {
  products: Array<{ id: string; name: string; supplierId: string; unit: string; purchaseCostMinor: number; storageNorm: string; status: string }>;
  batches: Array<{ id: string; productId: string; purchaseRequestId: string; receivedAt: string; expiresAt: string; quantity: number; remainingQuantity: number; unit: string; warehouse: string; status: string; qualityNote: string; expiryBand: string }>;
  recipes: Array<{ id: string; dishName: string; version: number; yieldPortions: number; standardCostMinor: number; normDescription: string; menuDate: string; status: string }>;
  ingredients: Array<{ id: string; recipeId: string; productId: string; quantityPerBatch: number; unit: string; costMinor: number }>;
  production: Array<{ id: string; productionDate: string; recipeId: string; shiftId: string; plannedPortions: number; actualPortions: number; materialCostMinor: number; status: string; evidence: string }>;
  shipments: Array<{ id: string; productionId: string; destinationObjectId: string; shippedPortions: number; consumedPortions: number; returnedPortions: number; writtenOffPortions: number; revenueMinor: number; status: string; documentId: string; balance: number }>;
  shifts: Array<{ id: string; employeeEntityId: string; startedAt: string; endedAt: string; rateMinor: number; status: string; role: string }>;
  checks: Array<{ id: string; checkType: string; objectEntityId: string; checkedAt: string; result: string; violation: string; evidence: string; status: string; relatedTaskId: number | null }>;
  entityNames: Record<string, string>;
  economics: { revenueMinor: number; materialMinor: number; laborMinor: number; profitMinor: number; marginPercent: number };
  summary: { products: number; batches: number; urgentBatches: number; planned: number; actual: number; consumed: number; waste: number };
  chain: { purchaseId: string; batchId: string; recipeId: string; productionId: string; shipmentId: string; costId: string; revenueId: string };
  boundary: string;
};

const codes: Record<string, string> = {
  "Собственник": "OWNER",
  "Директор": "DIRECTOR",
  "Представитель Виталия": "REPRESENTATIVE",
  "Кухня": "KITCHEN",
  "Финансы": "FINANCE",
  "Закупки": "PROCUREMENT",
  "Юрист": "LEGAL",
  "HR": "HR",
  "Продажи": "SALES",
  "Маркетинг": "MARKETING",
  "Педагог": "TEACHER",
  "Методист": "METHODIST",
  "Родитель": "PARENT",
};

const tabs = ["Сегодня", "Партии и склад", "ТТК и меню", "Отгрузки", "Экономика и проверки"] as const;
type Tab = (typeof tabs)[number];
const tabItems = tabs.map((id) => ({ id, label: id }));
const rub = (value: number) => new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
}).format(value / 100);

export function FoodWorkspace({ role, notify, onTasksChanged, onOpenFinance }: {
  role: string;
  notify: (value: string) => void;
  onTasksChanged: () => void;
  onOpenFinance: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Сегодня");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/food", {
        cache: "no-store",
        headers: { "x-arthello-role": codes[role] ?? "" },
      });
      const payload = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setError("");
    } catch (caught) {
      setData(null);
      setError(caught instanceof Error ? caught.message : "Нет доступа");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/food-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": codes[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; reused?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.reused ? "Действие уже существует" : "Действие кухни сохранено");
      await load();
      onTasksChanged();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Ошибка");
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <PageContainer className="ahFoodPage">
      <PageHeader eyebrow="От производства до результата" title="Кухня" description="Партии, ТТК, производство, отгрузки и экономика." />
      <Card className="ahFoodStatus"><span role="status">Загружаем питание и производство…</span></Card>
    </PageContainer>;
  }

  if (error || !data) {
    return <PageContainer className="ahFoodPage">
      <PageHeader eyebrow="От производства до результата" title="Кухня" description="Партии, ТТК, производство, отгрузки и экономика." />
      <Card className="ahFoodStateCard"><EmptyState density="compact" title={error || "Раздел кухни недоступен"} description="Кухня доступна своей роли, финансам, руководителям и Представителю." action={<Button variant="primary" onClick={() => void load()}>Повторить</Button>} /></Card>
    </PageContainer>;
  }

  const recipe = data.recipes[0] ?? {
    id: "",
    dishName: "ТТК не создана",
    version: 0,
    yieldPortions: 0,
    standardCostMinor: 0,
    normDescription: "Добавьте технологическую карту",
    menuDate: "",
    status: "Нет данных",
  };
  const hasFoodData = Boolean(data.products.length || data.batches.length || data.recipes.length || data.production.length || data.shipments.length || data.shifts.length || data.checks.length);

  return <PageContainer className="ahFoodPage">
    <PageHeader
      eyebrow="От производства до результата"
      title="Кухня"
      description="Партии, ТТК, производство, отгрузки и прибыльность отдельного проекта кухни."
      actions={<Button variant="secondary" onClick={onOpenFinance}>Открыть финансы</Button>}
    />

    <Card className="ahFoodBoundary">
      <strong>{hasFoodData ? "Рабочий контур" : "Рабочая структура"}</strong>
      <span>{hasFoodData ? data.boundary : "Система не создаёт рецепты, остатки, производство или выручку без фактических исходных данных."}</span>
    </Card>

    <section className="ahFoodKpis" aria-label="Показатели питания и производства">
      <KpiCard label="Произведено" value={data.summary.actual} note={`из ${data.summary.planned} порций`} onClick={() => setTab("Сегодня")} />
      <KpiCard label="Потреблено" value={data.summary.consumed} note={`${data.summary.waste} порций списано`} onClick={() => setTab("Отгрузки")} />
      <KpiCard className="ahFoodKpiWarning" label="Срочные партии" value={data.summary.urgentBatches} note="по сроку годности" onClick={() => setTab("Партии и склад")} />
      <KpiCard className="ahFoodKpiPositive" label="Прибыль" value={rub(data.economics.profitMinor)} note={`маржа ${data.economics.marginPercent}%`} onClick={() => setTab("Экономика и проверки")} />
    </section>

    <div className="ahFoodTabs"><Tabs items={tabItems} value={tab} onChange={setTab} ariaLabel="Разделы питания и производства" /></div>

    {tab === "Сегодня" ? <div className="ahFoodLayout">
      <Card className="ahFoodPanel">
        <PanelHead eyebrow="Производственные задания" title={data.production[0]?.productionDate ? `Смена ${data.production[0].productionDate}` : "Текущая смена"} meta="план → факт" />
        {data.production.length ? <div className="ahFoodProductionList">{data.production.map((item) => <article key={item.id} data-ah-compact-card="true"><span>{item.actualPortions}</span><div><strong>{data.recipes.find((entry) => entry.id === item.recipeId)?.dishName ?? recordLabel("Технологическая карта", item.recipeId)}</strong><small>{recordLabel("Задание", item.id)} · {recordLabel("Смена", item.shiftId)} · план {item.plannedPortions}</small><p>{humanTechnicalText(item.evidence)}</p></div><em>{item.status}</em></article>)}</div> : <EmptyState density="compact" title="Производственных заданий пока нет" description="Смена формируется из действующей ТТК и фактического плана порций." />}
      </Card>
      <Card className="ahFoodPanel">
        <PanelHead eyebrow="Сотрудники и смены" title="Труд кухни" meta={rub(data.economics.laborMinor)} />
        {data.shifts.length ? <div className="ahFoodShiftList">{data.shifts.map((shift) => <CompactListCard key={shift.id} index={recordNumber(shift.id)} title={data.entityNames[shift.employeeEntityId] ?? recordLabel("Сотрудник", shift.employeeEntityId)} description={`${shift.role} · ${shift.startedAt.slice(11, 16)}–${shift.endedAt.slice(11, 16)} · ${rub(shift.rateMinor)} · ${shift.status}`} />)}</div> : <EmptyState density="compact" title="Смен пока нет" description="Труд и стоимость смен появятся после назначения реальных сотрудников." />}
      </Card>
    </div> : null}

    {tab === "Партии и склад" ? data.batches.length ? <div className="ahFoodBatchGrid">{data.batches.map((batch) => <Card key={batch.id} className={`ahFoodBatch ahFoodExpiry${expiryClass(batch.expiryBand)}`}>
      <header><span>{recordLabel("Партия", batch.id)}</span><em>{batch.expiryBand}</em></header><h2>{data.products.find((product) => product.id === batch.productId)?.name ?? recordLabel("Продукт", batch.productId)}</h2>
      <dl><div><dt>Получено</dt><dd>{batch.quantity} {batch.unit}</dd></div><div><dt>Остаток</dt><dd>{batch.remainingQuantity} {batch.unit}</dd></div><div><dt>Годен до</dt><dd>{batch.expiresAt}</dd></div><div><dt>Склад</dt><dd>{batch.warehouse}</dd></div></dl>
      <p>{batch.qualityNote}</p><footer><span>{data.products.find((product) => product.id === batch.productId)?.storageNorm}</span><Button className="ahFoodInlineButton" variant="secondary" disabled={busy === batch.id || batch.remainingQuantity < 100} onClick={() => void action({ action: "writeOffBatch", batchId: batch.id, quantity: 100, reason: "Списание подтверждено ответственным после проверки фактического остатка" }, batch.id)}>Списать 100 {batch.unit}</Button></footer>
    </Card>)}</div> : <Card className="ahFoodStateCard"><EmptyState density="compact" title="Партии и склад пока пусты" description="Здесь будут остаток, срок годности, место хранения, качество и документированное списание." /></Card> : null}

    {tab === "ТТК и меню" ? <div className="ahFoodLayout">
      <Card className="ahFoodPanel ahFoodRecipe">
        <PanelHead eyebrow="Технологическая карта" title={`${recipe.dishName} · версия ${recipe.version}`} meta={recipe.status} />
        <p>{recipe.normDescription}</p>
        {recipe.id ? <div className="ahFoodIngredientList">{data.ingredients.filter((item) => item.recipeId === recipe.id).map((item) => <article key={item.id} data-ah-compact-card="true"><span>{data.products.find((product) => product.id === item.productId)?.name ?? recordLabel("Продукт", item.productId)}</span><strong>{item.quantityPerBatch} {item.unit}</strong><em>{rub(item.costMinor)}</em></article>)}</div> : <EmptyState density="compact" title="Технологических карт пока нет" description="Версии рецептуры, нормы, выход и себестоимость появятся после добавления ТТК." />}
        <footer><span>Выход {recipe.yieldPortions} порций · норма {rub(recipe.standardCostMinor)}</span><Button className="ahFoodInlineButton" variant="secondary" disabled={!recipe.id || busy === recipe.id} onClick={() => void action({ action: "createRecipeVersion", recipeId: recipe.id, note: "Уточнение нормы по фактическому выходу и списанию" }, recipe.id)}>+ версия</Button></footer>
      </Card>
      <Card className="ahFoodPanel">
        <PanelHead eyebrow="Меню" title={recipe.menuDate || "Текущий день"} meta="объекты ArtHello" />
        {recipe.id ? <div className="ahFoodMenuCard"><span>Основное блюдо</span><strong>{recipe.dishName}</strong><p>Норма и себестоимость берутся из технологической карты версии {recipe.version}. Замена рецептуры требует новой версии и основания.</p><dl><div><dt>План</dt><dd>{data.summary.planned}</dd></div><div><dt>Факт</dt><dd>{data.summary.actual}</dd></div></dl></div> : <EmptyState density="compact" title="Меню пока не сформировано" description="План и факт порций формируются только после утверждённой ТТК." />}
      </Card>
    </div> : null}

    {tab === "Отгрузки" ? <Card className="ahFoodPanel">
      <PanelHead eyebrow="Ежедневные отгрузки" title="Потребление, возвраты и списание" meta="баланс должен быть 0" />
      {data.shipments.length ? <div className="ahFoodShipmentTable"><table><thead><tr><th>Отгрузка</th><th>Объект</th><th>Отгружено</th><th>Потреблено</th><th>Возврат</th><th>Списание</th><th>Баланс</th><th>Документ</th><th>Выручка</th></tr></thead><tbody>{data.shipments.map((shipment) => <tr key={shipment.id} data-ah-compact-card="true"><td data-label="Отгрузка">{recordLabel("Отгрузка", shipment.id)}</td><td data-label="Объект">{data.entityNames[shipment.destinationObjectId] ?? "Объект не указан"}</td><td data-label="Отгружено">{shipment.shippedPortions}</td><td data-label="Потреблено">{shipment.consumedPortions}</td><td data-label="Возврат">{shipment.returnedPortions}</td><td data-label="Списание">{shipment.writtenOffPortions}</td><td data-label="Баланс"><strong>{shipment.balance}</strong></td><td data-label="Документ">{recordLabel("Документ", shipment.documentId)}</td><td data-label="Выручка">{rub(shipment.revenueMinor)}</td></tr>)}</tbody></table></div> : <EmptyState density="compact" title="Отгрузок пока нет" description="Отгружено = потреблено + возврат + списание. Несходящийся баланс не закрывается." />}
    </Card> : null}

    {tab === "Экономика и проверки" ? <div className="ahFoodLayout">
      <Card className="ahFoodPanel ahFoodEconomics">
        <PanelHead eyebrow="Центр результата" title="Прибыльность кухни" meta="отдельный проект" />
        <div><span><small>Выручка</small><strong>{rub(data.economics.revenueMinor)}</strong></span><span><small>Продукты</small><strong>− {rub(data.economics.materialMinor)}</strong></span><span><small>Смены</small><strong>− {rub(data.economics.laborMinor)}</strong></span><span className="ahFoodProfit"><small>Прибыль</small><strong>{rub(data.economics.profitMinor)}</strong><em>{data.economics.marginPercent}%</em></span></div>
        <Button variant="secondary" onClick={onOpenFinance}>Открыть операции в финансах</Button>
      </Card>
      <Card className="ahFoodPanel">
        <PanelHead eyebrow="Контроль" title="Нарушения и проверки" meta={`${data.checks.length} записей`} />
        {data.checks.length ? <div className="ahFoodChecks">{data.checks.map((check) => <article key={check.id} data-ah-compact-card="true"><header><strong>{check.checkType} · {recordLabel("Проверка", check.id)}</strong><em>{check.result}</em></header><p>{check.violation || "Замечаний нет"}</p><small>{humanTechnicalText(check.evidence)}</small><footer>{check.relatedTaskId ? <span>{taskRecordLabel(check.relatedTaskId)}</span> : check.status !== "Закрыта" ? <Button className="ahFoodInlineButton" variant="secondary" disabled={busy === check.id} onClick={() => void action({ action: "createCheckTask", checkId: check.id }, check.id)}>+ Задача</Button> : <span>{check.status}</span>}</footer></article>)}</div> : <EmptyState density="compact" title="Проверок пока нет" description="Нарушения, доказательства, задачи и закрытие результата появятся после первой проверки." />}
      </Card>
    </div> : null}
  </PageContainer>;
}

function PanelHead({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string }) {
  return <header className="ahFoodPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{meta}</span></header>;
}

function expiryClass(value: string) {
  const normalized = value.toLocaleLowerCase("ru");
  if (normalized.includes("крит") || normalized.includes("проср")) return "Danger";
  if (normalized.includes("сроч") || normalized.includes("скоро")) return "Warning";
  return "Normal";
}
