"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "../icons";

type PasswordlessChallenge = {
  challengeId: string;
  channel: "sms" | "email";
  maskedTarget: string;
  expiresInSeconds: number;
  message: string;
  error?: string;
};

function safeReturnTo() {
  const value = new URLSearchParams(window.location.search).get("returnTo") || "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [challenge, setChallenge] = useState<PasswordlessChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("authError");
    if (code === "expired_link")
      setError("Ссылка уже использована или срок её действия истёк.");
    if (code === "central_denied")
      setError("ArtHello OS не подтвердила доступ сотрудника к дневнику.");
    if (code === "central_unavailable")
      setError("Вход сотрудников временно недоступен. Повторите позже.");
  }, []);

  const staffLoginHref = useMemo(() => {
    if (typeof window === "undefined") return "/auth/central/start";
    return `/auth/central/start?returnTo=${encodeURIComponent(safeReturnTo())}`;
  }, []);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/passwordless/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, returnTo: safeReturnTo() }),
      });
      const payload = (await response.json()) as PasswordlessChallenge;
      if (!response.ok)
        throw new Error(payload.error || "Не удалось отправить код");
      setChallenge(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/passwordless/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier,
          challengeId: challenge.challengeId,
          code: form.get("code"),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        returnTo?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok)
        throw new Error(payload.error || "Не удалось войти");
      const target = payload.returnTo || safeReturnTo();
      window.location.assign(
        target.startsWith("/") && !target.startsWith("//") ? target : "/",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setChallenge(null);
    setError("");
  }

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
          Родители и ученики входят по одноразовому коду. Постоянный пароль не нужен.
        </p>

        {!challenge ? (
          <form className="auth-form" onSubmit={requestCode}>
            <label className="auth-field" htmlFor="login-identifier">
              <span>Телефон или email</span>
              <input
                id="login-identifier"
                name="identifier"
                type="text"
                autoComplete="username"
                placeholder="+7 999 123-45-67 или name@example.ru"
                value={identifier}
                onChange={(event) => setIdentifier(event.currentTarget.value)}
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
              {busy ? "Отправляем…" : "Получить код"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <div className="auth-code-summary" role="status">
              <strong>Код отправлен</strong>
              <span>{challenge.maskedTarget}</span>
              <small>Код действует 10 минут и подходит только для одного входа.</small>
            </div>
            <label className="auth-field" htmlFor="login-code">
              <span>Код из сообщения</span>
              <input
                id="login-code"
                name="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="000000"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "login-error" : undefined}
                autoFocus
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
              {busy ? "Проверяем…" : "Войти"}
            </button>
            <button className="ghost-btn auth-secondary" type="button" onClick={restart}>
              Изменить телефон или email
            </button>
          </form>
        )}

        <div className="auth-separator" aria-hidden="true">
          <span>или</span>
        </div>
        <a className="ghost-btn auth-sso" href={staffLoginHref}>
          <Icon name="briefcase" size={18} />
          Войти сотруднику через ArtHello OS
        </a>

        <small className="auth-help">
          Доступ выдаёт школа. Родитель видит только дневник; интерфейс ArtHello OS ему не показывается.
        </small>
      </section>
    </main>
  );
}
