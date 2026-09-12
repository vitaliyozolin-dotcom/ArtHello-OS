import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "ArtHello Pay",
  description: "Безопасное управление оплатами образовательной группы ArtHello.",
  robots: { index: false, follow: false, nocache: true },
};

export default function ArtHelloPayPage() {
  return (
    <>
      <link rel="stylesheet" href="/pay-assets/styles.css" />
      <div id="app" aria-live="polite" />
      <div id="toast-root" className="toast-root" aria-live="assertive" />
      <Script type="module" src="/pay-assets/app.js" strategy="afterInteractive" />
    </>
  );
}
