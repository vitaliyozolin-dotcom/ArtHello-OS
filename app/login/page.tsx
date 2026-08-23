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
    <div className="gate-stage auth-stage">
      <section className="access-card auth-card">
        <Image src="/school-logo.svg" alt="" width={68} height={68} />
        <span className="eyebrow">Школа 1–11</span>
        <h1>Вход в дневник</h1>
        <p>
          Введите телефон или email из карточки семьи ArtHello OS и ваш пароль.
        </p>
        <form onSubmit={submit}>
          <label>
            <span>Телефон или email</span>
            <input
              name="login"
              type="text"
              inputMode="email"
              autoComplete="username"
              placeholder="+7 999 123-45-67 или name@example.ru"
              required
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-btn" disabled={busy}>
            <Icon name="lock" size={18} />
            {busy ? "Проверяем…" : "Войти"}
          </button>
        </form>
        <small>
          Первый пароль создаётся по одноразовой ссылке из SMS или письма. Если
          вы его забыли, Виталий сбросит доступ в карточке семьи ArtHello OS.
        </small>
      </section>
    </div>
  );
}
