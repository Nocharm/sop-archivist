# Bundled fonts

The server cannot download fonts at build time, so the files live here and load through `next/font/local` (`src/app/fonts.ts`).

| File | Source | License | Changes |
|---|---|---|---|
| `PretendardVariable.woff2` | Pretendard 1.309 (orioncactus/pretendard) | SIL OFL 1.1, `Pretendard-OFL.txt` | none |
| `ArchivistAccent-Medium.woff2`, `ArchivistAccent-Bold.woff2` | Gmarket Sans TTF Medium, Bold 1.000 (eBay Korea) | SIL OFL 1.1, `ArchivistAccent-GmarketSans-OFL.txt` | converted to WOFF2 and renamed, because the Reserved Font Name "Gmarket Sans Font" may not be used on a modified copy; all glyphs kept |
| `JetBrainsMono-Regular.woff2`, `JetBrainsMono-SemiBold.woff2` | JetBrains Mono v2.304 release zip, `fonts/webfonts/` | SIL OFL 1.1, `JetBrainsMono-OFL.txt` | none |
