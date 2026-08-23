"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { Icon } from "../icons";

export default function ActivatePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    if (values.password !== values.confirmPassword) {
      setError("Пароли не совпадают");
      setBusy(false);
      return;
    }
    const token =
      new URLSearchParams(window.location.search).get("token") || "";
    try {
      const response = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: values.password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error || "Не удалось создать пароль");
      window.location.assign("/");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Не удалось создать пароль",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate-stage auth-stage">
      <section className="access-card auth-card">
        <Image src="/school-logo.svg" alt="" width={68} height={68} />
        <span className="eyebrow">Первый вход</span>
        <h1>Создайте свой пароль</h1>
        <p>
          Ссылка одноразовая. После сохранения она перестанет работать, а все
          прежние сессии будут закрыты.
        </p>
        <form onSubmit={submit}>
          <label>
            <span>Новый пароль</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </label>
          <label>
            <span>Повторите пароль</span>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </label>
          <small className="password-hint">
            Минимум 10 символов, хотя бы одна буква и одна цифра.
          </small>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-btn" disabled={busy}>
            <Icon name="check" size={18} />
            {busy ? "Сохраняем…" : "Создать пароль и войти"}
          </button>
        </form>
      </section>
    </div>
  );
}
