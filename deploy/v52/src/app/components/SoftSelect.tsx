"use client";

import { createPortal } from "react-dom";
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./SoftSelect.module.css";

export type SoftSelectOption = { value: string; label: string; description?: string };

export function SoftSelect({
  name,
  value,
  defaultValue,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SoftSelectOption[];
  onChange?: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState(defaultValue ?? options[0]?.value ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 240 });
  const selectedValue = value ?? internal;
  const selected = options.find((option) => option.value === selectedValue) ?? options[0];

  const updatePosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = Math.min(320, options.length * 48 + 14);
    setPosition({
      top: spaceBelow >= estimatedHeight + 10 ? rect.bottom + 7 : Math.max(10, rect.top - estimatedHeight - 7),
      left: Math.min(rect.left, Math.max(10, window.innerWidth - rect.width - 10)),
      width: rect.width,
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const update = () => updatePosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function choose(option: SoftSelectOption) {
    if (value === undefined) setInternal(option.value);
    onChange?.(option.value);
    setOpen(false);
    requestAnimationFrame(() => rootRef.current?.querySelector("button")?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); setActiveIndex(Math.max(0, options.findIndex((option) => option.value === selectedValue))); return; }
      setActiveIndex((current) => event.key === "ArrowDown" ? (current + 1) % options.length : (current - 1 + options.length) % options.length);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(options[activeIndex] ?? options[0]);
    }
  }

  return <div className={styles.root} ref={rootRef}>
    {name ? <input type="hidden" name={name} value={selected?.value ?? ""} /> : null}
    <button
      type="button"
      className={`${styles.trigger} ${open ? styles.open : ""}`}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => { setOpen((current) => !current); setActiveIndex(Math.max(0, options.findIndex((option) => option.value === selectedValue))); }}
      onKeyDown={onKeyDown}
    >
      <span><strong>{selected?.label ?? "Выберите"}</strong>{selected?.description ? <small>{selected.description}</small> : null}</span>
      <i aria-hidden="true" />
    </button>
    {open && typeof document !== "undefined" ? createPortal(<div
      ref={menuRef}
      className={styles.menu}
      role="listbox"
      aria-label={ariaLabel}
      style={{ top: position.top, left: position.left, width: position.width }}
    >{options.map((option, index) => <button
      type="button"
      role="option"
      aria-selected={option.value === selectedValue}
      className={`${option.value === selectedValue ? styles.selected : ""} ${index === activeIndex ? styles.focused : ""}`}
      key={option.value}
      onMouseEnter={() => setActiveIndex(index)}
      onClick={() => choose(option)}
    ><span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>{option.value === selectedValue ? <b aria-hidden="true">✓</b> : null}</button>)}</div>, document.body) : null}
  </div>;
}
