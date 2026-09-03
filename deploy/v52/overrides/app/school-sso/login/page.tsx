"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./school-sso-login.module.css";

function safeContinue() {
  const value =
    new URLSearchParams(window.location.search).get("continue") || "/";
  return value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : "/";
}

export default function SchoolSsoLoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!active || !response.ok) return;
        const user = (await response.json()) as { mustChangePassword?: boolean };
        if (user.mustChangePassword) {
          setPasswordChangeRequired(true);
          return;
        }
        window.location.replace(safeContinue());
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
    setNotice("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(values),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        mustChangePassword?: boolean;
      };
      if (!response.ok)
        throw new Error(payload.error || "Не удалось войти в ArtHello OS");
      if (payload.mustChangePassword) {
        setPasswordChangeRequired(true);
        return;
      }
      window.location.replace(safeContinue());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось войти в ArtHello OS",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const values = new FormData(event.currentTarget);
    const newPassword = String(values.get("newPassword") || "");
    const confirmation = String(values.get("confirmation") || "");
    if (newPassword !== confirmation) {
      setBusy(false);
      setError("Новые пароли не совпадают");
      return;
    }
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": readCookie("__Host-arthello_csrf"),
        },
        credentials: "same-origin",
        body: JSON.stringify({
          currentPassword: values.get("currentPassword"),
          newPassword,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || "Не удалось изменить пароль");
      setPasswordChangeRequired(false);
      setNotice("Пароль сохранён. Войдите ещё раз с новым паролем.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось изменить пароль",
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
        <h1 id="school-sso-title">
          {passwordChangeRequired ? "Задайте постоянный пароль" : "Вход сотрудника"}
        </h1>
        <p className={styles.intro}>
          {passwordChangeRequired
            ? "Введите временный пароль ещё раз и задайте свой — не короче 12 символов."
            : "Войдите в ArtHello OS. После проверки доступа вы автоматически вернётесь в электронный дневник — второго пароля не будет."}
        </p>
        {passwordChangeRequired ? (
          <form onSubmit={changePassword} className={styles.form}>
            <label>
              <span>Временный пароль</span>
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={Boolean(error)}
              />
            </label>
            <label>
              <span>Новый пароль</span>
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                aria-invalid={Boolean(error)}
              />
            </label>
            <label>
              <span>Повторите новый пароль</span>
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                aria-invalid={Boolean(error)}
              />
            </label>
            <div className={styles.errorSlot} aria-live="polite">
              {error ? <p role="alert">{error}</p> : null}
            </div>
            <button type="submit" disabled={busy} aria-busy={busy}>
              {busy ? "Сохраняем…" : "Сохранить пароль"}
            </button>
          </form>
        ) : (
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
              {notice ? <p role="status">{notice}</p> : null}
              {error ? <p role="alert">{error}</p> : null}
            </div>
            <button type="submit" disabled={busy} aria-busy={busy}>
              {busy ? "Проверяем доступ…" : "Войти и открыть дневник"}
            </button>
          </form>
        )}
        <small>
          Эта страница предназначена только для сотрудников. Родители входят
          непосредственно в дневник по одноразовому коду.
        </small>
      </section>
    </main>
  );
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const item = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!item) return "";
  try {
    return decodeURIComponent(item.slice(prefix.length));
  } catch {
    return "";
  }
}
