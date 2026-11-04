// 루트 레이아웃 - 언어 컨텍스트 + 인증 게이트(Providers)로 모든 화면을 감싼다. 상단 바는 로그인한 화면에서만 게이트 안(AppShell)이 그린다.
import type { Metadata } from "next";

import "./globals.css";

import { Providers } from "@/components/providers";
import { LangProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "SOP Archivist",
  description: "SOP Archivist",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <LangProvider>
          <Providers>{children}</Providers>
        </LangProvider>
      </body>
    </html>
  );
}
