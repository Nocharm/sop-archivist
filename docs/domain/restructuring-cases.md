# SOP 재구성 사례

- **출처**: TF·QA·AX팀 2026-07-08 회의 자료. 괄호 안 숫자는 슬라이드 번호다. 자료에는 "단순 예시이며 구조화 과정에서 변경 예정"이라고 적혀 있다.
- **성격**: 구조 수준의 참고 기대값이다. QA가 승인한 정답이 아니고, 원문 SOP 전체와 문장별 정답은 받지 않았다.
- **쓰임**: 합성 검증 데이터의 구조(옛 SOP 수 → 새 SOP·WI 수, 다대일 관계)와 AI 지침의 배치 예시. 지침의 예시로 쓴 사례와 검증용 사례는 섞지 않는다(5절).

## 1. QC Centrifuge: 첫 합성 검증 사례 (29)

| 옛 SOP | 대상 장비 |
|---|---|
| SOP-QC-00005 | Eppendorf Centrifuge and Microcentrifuge |
| SOP-QC-00155 | Eppendorf 5702R Centrifuge |
| SOP-QC-00346 | Beckman Coulter Centrifuge and Microcentrifuge |
| SOP-QC-00516 | Thermoscientific centrifuge |
| SOP-QC-00521 | Labogene Centrifuge |

- 기대 구조는 `Use and Maintenance of QC Centrifuge` SOP 1개와 그 아래 제조사별 Operation WI 4개(Eppendorf, Beckman Coulter, Thermoscientific, Labogene)다.
- 목적이 같은 장비의 SOP는 하나로 합치고, 비교적 단순한 조작법은 제조사별 WI로 나눈다.
- Eppendorf 문서 2개가 같은 WI로 모이므로 다대일 관계를 검증하기 좋다.
- 옛 문장이 모두 WI로 간다는 뜻은 아니다. 공통 요구사항이나 R&R 같은 문장은 부모 SOP로 가야 한다.
- 합성 데이터에서는 실제 문서 번호 대신 가짜 번호(`OLD-1`–`OLD-5`)를 쓴다. `OLD-1`·`OLD-2`는 Eppendorf, `OLD-3`은 Beckman Coulter, `OLD-4`는 Thermoscientific, `OLD-5`는 Labogene 문서다.

## 2. Media Preparation (15)

옛 SOP 3개(SOP-MFE-00143 Plant 2, SOP-MFE-00328 Plant 3, SOP-MFE-00749 Plant 4)를 부모 SOP `Media Preparation Operation` 1개와 WI 9개로 바꾼다.

| WI | 내용 | 구조의 의미 |
|---|---|---|
| 1 | 공정 진행을 위한 장비 상태 확인 | 공통 요구와 준비 작업 |
| 2–4 | 배지 이송 라인 SIP, P2/P3/P4 | Recipe/Prompt 차이가 가독성에 영향을 주면 공장별로 나눔(X02) |
| 5–7 | Pre-fill / 배지 조제 / 배지 이송, P2/P3/P4 | 공장별 작업 흐름 |
| 8 | 장비 정리 | 차이가 간단하면 공통 WI 안에서 표현 |
| 9 | 장비 관리: 압력 테스트, 베슬 SIP | 유지관리 작업 묶음 |

슬라이드 표에서 같은 행에 있는 As-Is와 To-Be를 문장 하나씩 짝지은 것으로 읽으면 안 된다.

## 3. 기타 구조 사례

| 사례 | 슬라이드 | 기대 구조와 판단 |
|---|---:|---|
| Bioreactor Media/Cell Transfer | 16 | SOP-MFP-00186(267쪽). 작업 흐름으로 WI 7개를 만들고, 제품 차이는 읽기 쉽게 표로 정리 |
| UV-Vis | 17 | SOP-QC-00377을 역할별(Operator, Reviewer, Admin, Maintenance) WI 4개로 나눔 |
| QC Autoclave | 28 | 목적이 다른 Decontamination과 Part Sterilization을 SOP 2개로 나눔. 첫 SOP 아래 모델별 WI 3개, 둘째 SOP 아래 BMT WI 1개 |
| QC SoloVPE | 28 | SOP-QC-00294와 00545를 SOP 1개로 합침. 소프트웨어별 Operation 2개, Admin 2개, 공통 Maintenance 1개 |
| DS Microscope | 29 | SOP-MFE-00032와 SOP-MFP-00222를 합침. 장비 모델별 WI 3개와 Examination WI 1개. 작업자와 교육 대상이 같다는 것이 근거 |
| Document Transmittal | 30 | SOP-QA-00024. 단순한 Form 작성은 SOP에, EQUIS TMD/QRTM 작업은 WI 2개로 |
| Tempered Water/Glycol | 30 | 옛 SOP 5개를 Heat Exchanger Operation으로 합침. 작업법 WI 3개와 공통 유지관리 WI 1개 |

## 4. 문장을 어디에 둘지 보여 주는 사례

- Grade A/B 반입에 승인이 필요하다는 요구는 SOP에 둔다. 특정 반입 단계에서 QL-00742를 확인하는 행동은 WI에 둔다(11).
- Clean Hold Time이 유효해야 한다는 요구는 SOP에 둔다. 로그북이나 라벨에서 이를 확인하는 행동은 WI에 둔다(11).
- Chromatogram Review의 적용 범위와 검토 파라미터는 관련 공정 SOP에 합칠 후보다(27).
- 클린 스팀 블리딩에서 잔류 공기와 응축수를 빼는 이유 설명은 필요한 Why의 예다(19).
- pH 전극의 정의와 교체 지시가 섞인 긴 Why는 Definition과 Instruction으로 나눌지 검토한다(32).

## 5. 데이터를 쓰는 원칙

| 데이터 | 쓸 수 있는 곳 | 주장할 수 없는 것 |
|---|---|---|
| 회의 자료의 구조 사례 | SOP/WI 개수, 분류 근거 비교 | 모든 문장의 정답, 실제 위험 평가 |
| 명시적으로 만든 합성 문장, 문서 | 추출기, ID, 배정 제약, 재시도, 화면, Excel 검증 | 실제 SOP에서의 AI 정확도 |
| QA가 확정한 실제 원문과 배정 결과 | 문장 배정과 근거의 적합성 평가 | 받지 않은 문서의 누락 없음 |

- 정답 데이터를 확정할 때는 QA 검토자, 검토일, 원문 버전, 규칙 버전, 허용하는 대안, 판단 이유를 함께 관리한다.
- 모델을 바꾸면 같은 평가셋으로 비교한다.
- 지침의 예시로 쓴 사례와 검증용 사례는 섞지 않는다.
