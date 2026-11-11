# Bundled fonts

The server cannot download fonts at build time, so the files live here and load through `next/font/local` (`src/app/fonts.ts`).

| File | Source | License | Changes |
|---|---|---|---|
| `PretendardVariable.woff2` | Pretendard 1.309 (orioncactus/pretendard) | SIL OFL 1.1, `Pretendard-OFL.txt` | none |
| `Paperlogy-SemiBold.woff2` (165 KB) | Paperlogy 6 SemiBold, 이주임(Lee Juim)의 페이퍼로지, `Paperlogy-6SemiBold.woff2` of the fonts-archive/Paperlogy GitHub mirror of the official distribution (freesentation.blog/paperlogyfont) | SIL OFL 1.1, `Paperlogy-OFL.txt` (no Reserved Font Name declared) | none; all 11,172 Hangul syllables verified in the cmap, so no unicode-range slices are needed |
| `JetBrainsMono-Regular.woff2`, `JetBrainsMono-SemiBold.woff2` | JetBrains Mono v2.304 release zip, `fonts/webfonts/` | SIL OFL 1.1, `JetBrainsMono-OFL.txt` | none |
