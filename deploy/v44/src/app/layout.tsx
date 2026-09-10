import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://arthello-188-225-38-55.sslip.io"),
  title: "ArtHello OS",
  description: "Единая операционная система образовательной группы ArtHello.",
  openGraph: {
    title: "ArtHello OS",
    description: "Единая операционная система образовательной группы.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ArtHello OS" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ArtHello OS",
    description: "Единая операционная система образовательной группы ArtHello.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
