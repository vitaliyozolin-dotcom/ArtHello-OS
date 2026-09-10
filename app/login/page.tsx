"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../icons";
import styles from "./passwordless-login.module.css";

type PasswordlessChallenge = {
  challengeId: string;
  channel: "sms" | "email";
  maskedTarget: string;
  expiresInSeconds: number;
  message: string;
  error?: string;
};

type FamilyMethod = "code" | "password";

const parentOtpEnabled =
  process.env.NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED === "true";

function safeReturnTo() {
  const value = new URLSearchParams(window.location.search).get("returnTo") || "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [challenge, setChallenge] = useState<PasswordlessChallenge | null>(null);
  const [familyMethod, setFamilyMethod] = useState<FamilyMethod>("password");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const code = new URLSearchParams(window.location.search).get("authError");
      if (code === "expired_link")
        setError("Ссылка уже использована или срок её действия истёк.");
      if (code === "central_denied")
        setError("Не удалось подтвердить доступ сотрудника к дневнику.");
      if (code === "central_unavailable")
        setError("Вход сотрудников временно недоступен. Повторите позже.");
    });
    return () => cancelAnimationFrame(frame);
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

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: identifier, password }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok)
        throw new Error(payload.error || "Не удалось войти");
      window.location.assign(safeReturnTo());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  function restartCode() {
    setChallenge(null);
    setError("");
  }

  function selectFamilyMethod(method: FamilyMethod) {
    setFamilyMethod(method);
    setChallenge(null);
    setPassword("");
    setError("");
  }

  return (
    <main className="gate-stage auth-stage" data-auth-mode="staff-sso-safe-rollout">
      <section className="access-card auth-card" aria-labelledby="login-title">
        <Image
          className="auth-logo"
          src="/atlas-mark.svg"
          alt=""
          width={48}
          height={48}
          priority
        />
        <span className="auth-brand-name">Школа Атлас</span>
        <h1 id="login-title">Вход в дневник</h1>
        <p className="auth-intro">
          Сотрудникам не нужен второй пароль. Родители и ученики входят прямо в
          электронный дневник.
        </p>

        <Link className={`ghost-btn ${styles.sso}`} href="/auth/central/start">
          <Icon name="school" size={18} />
          Вход для сотрудников
        </Link>

        <div className={styles.separator} aria-hidden="true">
          <span>родителям и ученикам</span>
        </div>

        {parentOtpEnabled && familyMethod === "code" && !challenge ? (
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
            <button
              className={`ghost-btn ${styles.secondary}`}
              type="button"
              onClick={() => selectFamilyMethod("password")}
            >
              Войти по выданному паролю
            </button>
          </form>
        ) : null}

        {parentOtpEnabled && familyMethod === "code" && challenge ? (
          <form className="auth-form" onSubmit={verifyCode}>
            <div className={styles.codeSummary} role="status">
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
            <button
              className={`ghost-btn ${styles.secondary}`}
              type="button"
              onClick={restartCode}
            >
              Изменить телефон или email
            </button>
          </form>
        ) : null}

        {familyMethod === "password" ? (
          <form className="auth-form" onSubmit={loginWithPassword}>
            <div className={styles.codeSummary} role="note">
              <strong>Вход для семьи и ученика</strong>
              <small>
                Используйте действующие данные, выданные школой. Сотрудники входят
                через рабочую систему школы.
              </small>
            </div>
            <label className="auth-field" htmlFor="legacy-identifier">
              <span>Телефон или email</span>
              <input
                id="legacy-identifier"
                name="login"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.currentTarget.value)}
                aria-invalid={Boolean(error)}
                required
              />
            </label>
            <label className="auth-field" htmlFor="legacy-password">
              <span>Пароль, выданный школой</span>
              <input
                id="legacy-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                aria-invalid={Boolean(error)}
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
              {busy ? "Входим…" : "Войти в дневник"}
            </button>
            {parentOtpEnabled ? (
              <button
                className={`ghost-btn ${styles.secondary}`}
                type="button"
                onClick={() => selectFamilyMethod("code")}
              >
                Получить код
              </button>
            ) : null}
          </form>
        ) : null}

        <small className="auth-help">
          Нет доступа или изменился контакт? Обратитесь к администратору школы.
        </small>
      </section>
    </main>
  );
}
