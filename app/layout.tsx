import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Школа 1–11",
  description: "Боевой учебный модуль ArtHello OS: расписание, журнал, задания, календарь, семьи и школьная жизнь.",
  icons: {
    icon: "/school-logo.svg",
    shortcut: "/school-logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
