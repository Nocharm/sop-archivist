# Bundled fonts

The server cannot download fonts at build time, so the files live here and load through `next/font/local` (`src/app/fonts.ts`).

| File | Source | License | Changes |
|---|---|---|---|
| `PretendardVariable.woff2` | Pretendard 1.309 (orioncactus/pretendard) | SIL OFL 1.1, `Pretendard-OFL.txt` | none |
| `IBMPlexSansKR-Medium.woff2` (562 KB), `IBMPlexSansKR-SemiBold.woff2` (558 KB) | IBM Plex Sans KR 1.001, the `korean-500` and `korean-600` files of `@fontsource/ibm-plex-sans-kr` 5.3.0 (IBM) | SIL OFL 1.1, `IBMPlexSansKR-OFL.txt` (no Reserved Font Name) | none; all 11,172 Hangul syllables and printable ASCII verified in the cmap, so no unicode-range slices are needed |
| `JetBrainsMono-Regular.woff2`, `JetBrainsMono-SemiBold.woff2` | JetBrains Mono v2.304 release zip, `fonts/webfonts/` | SIL OFL 1.1, `JetBrainsMono-OFL.txt` | none |
