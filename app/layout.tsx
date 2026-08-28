import type { Metadata } from "next";
import "./design-tokens.css";
import "./themes/student.css";
import "./globals.css";
import "./mobile-polish.css";

export const metadata: Metadata = {
  title: "Школа 1–11",
  description:
    "Боевой учебный модуль ArtHello OS: расписание, журнал, задания, календарь, семьи и школьная жизнь.",
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
  const designCodeVersion =
    process.env.NEXT_PUBLIC_SCHOOL_DESIGN_V1 === "true" ? "v1" : undefined;

  return (
    <html lang="ru" data-design-code={designCodeVersion}>
      <body>{children}</body>
    </html>
  );
}
