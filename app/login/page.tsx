"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { Icon } from "../icons";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось войти");
      const returnTo =
        new URLSearchParams(window.location.search).get("returnTo") || "/";
      window.location.assign(
        returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/",
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Не удалось войти",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="gate-stage auth-stage">
      <section className="access-card auth-card" aria-labelledby="login-title">
        <Image
          className="auth-logo"
          src="/school-logo.svg"
          alt=""
          width={48}
          height={48}
          priority
        />
        <span className="auth-brand-name">Школа 1–11</span>
        <h1 id="login-title">Вход в дневник</h1>
        <p className="auth-intro">
          Используйте телефон или email, указанный при подключении к школе.
        </p>

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field" htmlFor="login-identifier">
            <span>Телефон или email</span>
            <input
              id="login-identifier"
              name="login"
              type="text"
              autoComplete="username"
              placeholder="+7 999 123-45-67 или name@example.ru"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-error" : undefined}
              required
            />
          </label>

          <label className="auth-field" htmlFor="login-password">
            <span>Пароль</span>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-error" : undefined}
              required
            />
          </label>

          <div className="auth-error-slot" aria-live="polite" aria-atomic="true">
            {error ? (
              <p id="login-error" className="auth-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <button
            className="primary-btn auth-submit"
            type="submit"
            disabled={busy}
            aria-busy={busy}
          >
            <Icon name="lock" size={18} />
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>

        <small className="auth-help">
          Нет доступа или забыли пароль? Обратитесь к администратору школы.
        </small>
      </section>
    </main>
  );
}
