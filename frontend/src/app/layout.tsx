// 루트 레이아웃 - 글꼴 변수, 첫 페인트 전 화면 설정, 언어 컨텍스트 + 인증 게이트(Providers)로 모든 화면을 감싼다. 상단 바는 로그인한 화면에서만 게이트 안(AppShell)이 그린다.
import type { Metadata } from "next";

import "./globals.css";

import { fontAccent, fontMono, fontUi } from "@/app/fonts";
import { Providers } from "@/components/providers";
import { LangProvider } from "@/lib/i18n";
import { buildPrefsBootScript, getDefaultPrefAttrs } from "@/lib/ui-prefs";

export const metadata: Metadata = {
  title: "SOP Archivist",
  description: "SOP Archivist",
};

const PREFS_BOOT_SCRIPT = buildPrefsBootScript();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 부트 스크립트가 하이드레이션 전에 lang·data 속성을 바꾸므로 이 요소의 속성 차이만 허용한다
    <html
      lang="en"
      {...getDefaultPrefAttrs()}
      className={`${fontUi.variable} ${fontAccent.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <LangProvider>
          <Providers>{children}</Providers>
        </LangProvider>
      </body>
    </html>
  );
}
