// 저장소에 넣은 글꼴 셋 - 사내망 서버는 빌드 때 외부에서 받지 못한다. 각 글꼴은 CSS 변수로만 내보내고 tokens.css가 쓴다.
import localFont from "next/font/local";

export const fontUi = localFont({
  src: "./fonts/PretendardVariable.woff2",
  weight: "45 920",
  variable: "--font-pretendard",
  display: "swap",
});

// 강조 글꼴은 세로 값이 두 벌(800/200, 800/350)이라 OS마다 줄 안 위치가 달라진다 - 보정 값은 디자인 문서 6절에서 잰 것
export const fontAccent = localFont({
  src: [
    { path: "./fonts/ArchivistAccent-Medium.woff2", weight: "500" },
    { path: "./fonts/ArchivistAccent-Bold.woff2", weight: "700" },
  ],
  variable: "--font-archivist-accent",
  display: "swap",
  declarations: [
    { prop: "ascent-override", value: "82%" },
    { prop: "descent-override", value: "18%" },
    { prop: "line-gap-override", value: "0%" },
  ],
});

export const fontMono = localFont({
  src: [
    { path: "./fonts/JetBrainsMono-Regular.woff2", weight: "400" },
    { path: "./fonts/JetBrainsMono-SemiBold.woff2", weight: "600" },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
