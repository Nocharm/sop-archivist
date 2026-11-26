---
description: 정식 업데이트(dev→main) · 운영 급한 수정 · 문서 정리 절차를 docs/deploy/release.md대로 진행한다.
---

`docs/deploy/release.md`를 끝까지 읽고, 사용자가 말한 일(정식 업데이트 준비 · main 합치기와 태그 · 운영 급한 수정 · 배포일 기록 · 문서 정리 중 하나)을 그 문서대로 한다. 진행 중인 장부(`docs/superpowers/plans/*-ledger.md`)가 있으면 "이어 가기" 절도 먼저 읽는다.

- main 합치기 · 태그 푸시는 사용자 승인을 받은 뒤에. GitLab push · 배포는 하지 않는다(사용자 몫).
- 준비 커밋 전에 운영 DB의 기존 행을 바꾸는 Alembic 리비전이 있는지 보고 배포 메모에 굵게 적는다(루트 CLAUDE.md 상태 줄).

$ARGUMENTS
