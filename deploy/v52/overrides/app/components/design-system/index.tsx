"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./tokens.css";
import "./design-system.css";

type CommonProps = { children: ReactNode; className?: string };
const join = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

export function PageContainer({ children, className }: CommonProps) {
  return <section className={join("ahPageContainer", className)}>{children}</section>;
}

export function PageHeader({ title, description, eyebrow, actions, className }: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return <header className={join("ahPageHeader", className)}>
    <div className="ahPageHeaderCopy">
      {eyebrow ? <small>{eyebrow}</small> : null}
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
    {actions ? <div className="ahPageHeaderActions">{actions}</div> : null}
  </header>;
}

export function Card({ children, className }: CommonProps) {
  return <div className={join("ahCard", className)}>{children}</div>;
}

export function Button({ variant = "secondary", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  return <button type={type} className={join("ahButton", `ahButton-${variant}`, className)} {...props} />;
}

export function KpiCard({ icon, label, value, note, onClick, className }: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  note?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const content = <>
    {icon ? <span className="ahKpiIcon" aria-hidden="true">{icon}</span> : null}
    <span className="ahKpiCopy"><small>{label}</small><strong>{value}</strong>{note ? <span>{note}</span> : null}</span>
  </>;
  const classes = join("ahCard", "ahKpiCard", !icon && "ahKpiCardNoIcon", className);
  return onClick
    ? <button type="button" className={classes} onClick={onClick}>{content}</button>
    : <div className={classes}>{content}</div>;
}

export function EmptyState({ title, description, action, className }: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return <div className={join("ahEmptyState", className)}><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function SearchField({ value, onChange, placeholder, label, icon, help, className }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  icon?: ReactNode;
  help?: ReactNode;
  className?: string;
}) {
  return <label className={join("ahSearchField", !icon && "ahSearchFieldNoIcon", !help && "ahSearchFieldNoHelp", className)}>
    <span className="sr-only">{label}</span>
    {icon ? <span className="ahSearchIcon" aria-hidden="true">{icon}</span> : null}
    <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label} />
    {help ? <span className="ahSearchHelp">{help}</span> : null}
  </label>;
}

export function Tabs<T extends string>({ items, value, onChange, ariaLabel = "Разделы" }: {
  items: Array<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return <div className="ahTabs" role="tablist" aria-label={ariaLabel}>{items.map((item) => <button type="button" role="tab" aria-selected={value === item.id} key={item.id} onClick={() => onChange(item.id)}>{item.label}</button>)}</div>;
}

export function PeriodSelector({ label = "Отчётный период", periodLabel, onPrevious, onNext, onCurrent, centerControl }: {
  label?: string;
  periodLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onCurrent: () => void;
  centerControl?: ReactNode;
}) {
  return <div className="ahPeriodSelector"><div className="ahPeriodTop"><strong>{label}</strong><button type="button" onClick={onCurrent}>Текущий месяц</button></div><div className="ahPeriodControls"><button type="button" onClick={onPrevious} aria-label="Предыдущий месяц">←</button>{centerControl ?? <div aria-label={label}>{periodLabel}</div>}<button type="button" onClick={onNext} aria-label="Следующий месяц">→</button></div></div>;
}

export const designSystemVersion = "1.0-pilot";
