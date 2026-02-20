import type { Metadata } from "next";
import { IBM_Plex_Sans, Rubik } from "next/font/google";
import { AppHeader } from "@/components/app-header";
import "./globals.css";

const bodyFont = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500", "600"],
});

const headingFont = Rubik({
  variable: "--font-heading",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Onco Validation MVP | Проверка онколечения",
  description:
    "AI-помощник для ретроспективной проверки протоколов лечения онкопациентов по клиническим рекомендациям.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${bodyFont.variable} ${headingFont.variable} antialiased`}>
        <div className="relative min-h-screen overflow-x-hidden bg-[#061120]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(27,146,164,0.18),transparent_38%),radial-gradient(circle_at_90%_0%,rgba(58,92,190,0.22),transparent_42%),radial-gradient(circle_at_70%_90%,rgba(11,158,128,0.14),transparent_40%)]" />
          <AppHeader />
          <main className="relative z-10 mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-10">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
