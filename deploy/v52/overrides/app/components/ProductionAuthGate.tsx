"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import "./ProductionAuthGate.css";

type AuthUser = {
  role: "owner" | "accountant" | "viewer";
  name: string;
  mustChangePassword: boolean;
};

export default function ProductionAuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetchWithTimeout("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as AuthUser;
      })
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetchWithTimeout("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: data.get("login"), password: data.get("password") }),
      });
      const body = await response.json() as AuthUser & { error?: string };
      if (!response.ok) {
        setError(body.error || "Не удалось войти");
        return;
      }
      setUser(body);
    } catch {
      setError("Сервер не ответил за 15 секунд. Проверьте соединение и повторите один раз.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const next = String(data.get("newPassword") || "");
    const confirmation = String(data.get("confirmation") || "");
    if (next !== confirmation) {
      setBusy(false);
      setError("Новые пароли не совпадают");
      return;
    }
    try {
      const response = await fetchWithTimeout("/api/auth/password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": readCookie("__Host-arthello_csrf"),
        },
        body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: next }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setError(body.error || "Не удалось изменить пароль");
        return;
      }
      setUser(null);
      setNotice("Пароль сохранён. Войдите ещё раз с новым паролем.");
    } catch {
      setError("Сервер не ответил за 15 секунд. Повторите сохранение один раз.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <AuthScreen title="Проверяем защищённый вход"><p>Загрузка…</p></AuthScreen>;

  if (!user) {
    return (
      <AuthScreen title="Вход в ArtHello OS">
        <form onSubmit={login}>
          <label><span>Логин</span><input name="login" autoComplete="username" defaultValue="owner" required /></label>
          <label><span>Пароль</span><input name="password" type="password" autoComplete="current-password" required /></label>
          {notice ? <p className="auth-notice">{notice}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}
          <button disabled={busy}>{busy ? "Проверяем…" : "Войти"}</button>
        </form>
      </AuthScreen>
    );
  }

  if (user.mustChangePassword) {
    return (
      <AuthScreen title="Задайте постоянный пароль">
        <p>Первый вход выполнен. Введите временный пароль ещё раз и задайте свой — не короче 12 символов.</p>
        <form onSubmit={changePassword}>
          <label><span>Временный пароль</span><input name="currentPassword" type="password" autoComplete="current-password" required /></label>
          <label><span>Новый пароль</span><input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
          <label><span>Повторите новый пароль</span><input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить пароль"}</button>
        </form>
      </AuthScreen>
    );
  }

  return children;
}

function AuthScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="production-auth-screen">
      <section className="production-auth-card">
        <div className="production-auth-mark">A</div>
        <p className="production-auth-kicker">ЗАЩИЩЁННЫЙ КОНТУР</p>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return "";
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return ""; }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}
