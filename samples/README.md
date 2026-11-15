# 샘플 SOP 파일 (합성)

화면에 직접 올려 볼 합성 자료다. 모든 문장은 지어낸 것이고 실제 SOP가 아니다. QC Centrifuge 사례로, 옛 SOP 6개를 새 SOP 1개(`SOP-CF`)와 WI 5개로 다시 짜는 상황이다. 로컬 데모 시드(`scripts.seed_sop_demo`)가 묶음 4개에 올리는 것과 같은 파일이다.

| 파일 | 넣는 곳 | 언어 배치 |
|---|---|---|
| `SYNTHETIC_tobe.xlsx` | To-Be 목록 가져오기 (SOP-CF, WI-01~03과 단계) | — |
| `SYNTHETIC_OLD-1_…`, `OLD-2_…`, `OLD-4_…`, `OLD-6_…` (docx) | Old 문서 | 한/영 연달아 |
| `SYNTHETIC_OLD-3_Beckman_Coulter_Centrifuge.docx` | Old 문서 | 한/영 따로 |
| `SYNTHETIC_OLD-5_Labogene_Centrifuge.pdf` | Old 문서 (텍스트 PDF) | 영어만 |
| `SYNTHETIC_WI-04_Labogene_Centrifuge_Operation.docx` | 이미 쓴 New 문서 (상위 SOP-CF) | 영어만 |
| `SYNTHETIC_WI-05_Hanil_Centrifuge_Cleaning.docx` | 이미 쓴 New 문서 (상위 SOP-CF) | 한/영 연달아 |

## 다시 만들기

파일은 `backend/scripts/synthetic_sop.py`가 만든다. 생성기를 고치면 `backend/`에서 다시 쓴다(같은 입력이면 같은 바이트라 바뀐 파일만 diff에 잡힌다). 어긋난 채로 두면 `test_samples_match_generator`가 실패한다.

```bash
.venv/bin/python -m scripts.synthetic_sop
```

```powershell
.venv\Scripts\python -m scripts.synthetic_sop
```
