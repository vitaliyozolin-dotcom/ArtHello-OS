"use client";

import { FormEvent, lazy, Suspense, useCallback, useEffect, useState } from "react";
import "./ProductionAuthGate.css";

const ArtHelloShell = lazy(() => import("./ArtHelloShell"));

type AuthUser = {
  role: "owner" | "accountant" | "viewer";
  name: string;
  mustChangePassword: boolean;
};

export function ProductionAuthGate() {
  const [state, setState] = useState<"loading" | "signed-out" | "signed-in">("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        setUser(null);
        setState("signed-out");
        return;
      }
      setUser((await response.json()) as AuthUser);
      setState("signed-in");
    } catch {
      setUser(null);
      setState("signed-out");
      setError("Сервис входа временно недоступен");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void verify(), 0);
    return () => window.clearTimeout(timer);
  }, [verify]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: values.get("login"), password: values.get("password") }),
      });
      const payload = await response.json() as AuthUser & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось войти");
      setUser(payload);
      setState("signed-in");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const csrf = readCookie("__Host-arthello_csrf") ?? readCookie("arthello_csrf");
      if (!csrf) throw new Error("Защитная сессия устарела. Войдите заново.");
      const response = await fetch("/api/auth/password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ currentPassword: values.get("currentPassword"), newPassword: values.get("newPassword") }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось изменить пароль");
      setUser(null);
      setState("signed-out");
      setError("Пароль изменён. Войдите заново.");
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Не удалось изменить пароль");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const csrf = readCookie("__Host-arthello_csrf") ?? readCookie("arthello_csrf");
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: csrf ? { "x-csrf-token": csrf } : {},
    }).catch(() => null);
    setUser(null);
    setState("signed-out");
  }

  if (state === "loading") return <AuthScreen><div className="production-auth-loading"><span /><strong>Проверяем защищённую сессию…</strong></div></AuthScreen>;
  if (state === "signed-in" && user) {
    if (user.mustChangePassword) {
      return <AuthScreen><AuthForm title="Задайте постоянный пароль" subtitle="Временный пароль действует только для первого входа." error={error} onSubmit={changePassword} busy={busy} passwordChange /></AuthScreen>;
    }
    return <Suspense fallback={<AuthScreen><div className="production-auth-loading"><span /><strong>Открываем рабочий контур…</strong></div></AuthScreen>}><ArtHelloShell displayName={user.name} authenticatedRole={user.role} onLogout={() => void logout()} /></Suspense>;
  }
  return <AuthScreen><AuthForm title="Вход в ArtHello OS" subtitle="Используйте личную учётную запись. Доступ и филиалы назначает собственник." error={error} onSubmit={login} busy={busy} /></AuthScreen>;
}

function AuthScreen({ children }: { children: React.ReactNode }) {
  return <main className="production-auth-screen"><section className="production-auth-card"><div className="production-auth-brand"><span><i /><i /></span><strong>ArtHello <em>OS</em></strong></div>{children}</section><p>Закрытая операционная система образовательной группы</p></main>;
}

function AuthForm({ title, subtitle, error, onSubmit, busy, passwordChange = false }: { title: string; subtitle: string; error: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; passwordChange?: boolean }) {
  return <form className="production-auth-form" onSubmit={onSubmit}><header><h1>{title}</h1><p>{subtitle}</p></header>{passwordChange ? <><label><span>Текущий пароль</span><input name="currentPassword" type="password" autoComplete="current-password" required /></label><label><span>Новый пароль</span><input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></label></> : <><label><span>Почта или телефон</span><input name="login" type="text" autoComplete="username" required autoFocus /></label><label><span>Пароль</span><input name="password" type="password" autoComplete="current-password" required /></label></>}{error ? <p className="production-auth-error" role="alert">{error}</p> : null}<button disabled={busy}>{busy ? "Проверяем…" : passwordChange ? "Сохранить пароль" : "Войти"}</button></form>;
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const item = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}
