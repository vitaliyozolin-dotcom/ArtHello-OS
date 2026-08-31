"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./school-sso-login.module.css";

function safeContinue() {
  const value =
    new URLSearchParams(window.location.search).get("continue") || "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function SchoolSsoLoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => {
        if (active && response.ok) window.location.replace(safeContinue());
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || "Не удалось войти в ArtHello OS");
      window.location.replace(safeContinue());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось войти в ArtHello OS",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.stage}>
      <section className={styles.card} aria-labelledby="school-sso-title">
        <div className={styles.brandMark} aria-hidden="true">AH</div>
        <p className={styles.eyebrow}>ARTHELLO OS · БЕЗОПАСНЫЙ ПЕРЕХОД</p>
        <h1 id="school-sso-title">Вход сотрудника</h1>
        <p className={styles.intro}>
          Войдите в ArtHello OS. После проверки доступа вы автоматически
          вернётесь в электронный дневник — второго пароля не будет.
        </p>
        <form onSubmit={submit} className={styles.form}>
          <label>
            <span>Логин</span>
            <input
              name="login"
              type="text"
              autoComplete="username"
              required
              aria-invalid={Boolean(error)}
            />
          </label>
          <label>
            <span>Пароль ArtHello OS</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(error)}
            />
          </label>
          <div className={styles.errorSlot} aria-live="polite">
            {error ? <p role="alert">{error}</p> : null}
          </div>
          <button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? "Проверяем доступ…" : "Войти и открыть дневник"}
          </button>
        </form>
        <small>
          Эта страница предназначена только для сотрудников. Родители входят
          непосредственно в дневник по одноразовому коду.
        </small>
      </section>
    </main>
  );
}
