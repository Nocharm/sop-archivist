// 저장소에 넣은 글꼴 셋 - 사내망 서버는 빌드 때 외부에서 받지 못한다. 각 글꼴은 CSS 변수로만 내보내고 tokens.css가 쓴다.
import localFont from "next/font/local";

export const fontUi = localFont({
  src: "./fonts/PretendardVariable.woff2",
  weight: "45 920",
  variable: "--font-pretendard",
  display: "swap",
});

// 강조 글꼴 Paperlogy SemiBold - 세로 값이 hhea와 win이 같아(880/180, 1000 단위 900) OS마다 줄 안 위치가 달라지지 않으니 보정 선언이 없다
export const fontAccent = localFont({
  src: [{ path: "./fonts/Paperlogy-SemiBold.woff2", weight: "600" }],
  variable: "--font-accent-face",
  display: "swap",
});

export const fontMono = localFont({
  src: [
    { path: "./fonts/JetBrainsMono-Regular.woff2", weight: "400" },
    { path: "./fonts/JetBrainsMono-SemiBold.woff2", weight: "600" },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
