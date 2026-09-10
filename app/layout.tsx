import type { Metadata } from "next";
import "./design-tokens.css";
import "./themes/student.css";
import "./globals.css";
import "./mobile-polish.css";

export const metadata: Metadata = {
  title: "Школа Атлас",
  description:
    "Электронный дневник школы Атлас: расписание, журнал, задания, календарь и школьная жизнь.",
  icons: {
    icon: "/atlas-mark.svg",
    shortcut: "/atlas-mark.svg",
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
      <head>
        {designCodeVersion ? (
          <link
            rel="preload"
            href="/fonts/onest-variable.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}