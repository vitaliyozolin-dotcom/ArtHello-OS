"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("School app render error", error);
  }, [error]);

  return (
    <main className="app-error" role="alert">
      <span className="brand-mark">Атлас</span>
      <h1>Не получилось открыть экран</h1>
      <p>Данные прототипа не потеряны. Попробуй загрузить экран ещё раз.</p>
      <button onClick={reset}>Повторить</button>
      <Link href="/">На экран «Сегодня»</Link>
    </main>
  );
}
