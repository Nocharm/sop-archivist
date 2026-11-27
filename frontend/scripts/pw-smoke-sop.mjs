// SOP 화면 스모크(Playwright + 시스템 Chrome) - 묶음 목록, 개요, 단계 이동(레일·상단 탭), 배치 메뉴, 첫 페인트 전 설정.
// 전제: backend/에서 reset_db → seed_sop_demo(합성 묶음 4개 + 지도용 2개 + 목차 1개) 직후, backend 8777 + frontend 3777. 고친 값은 시나리오 안에서 되돌린다.
// AI 나눔 확정 시나리오는 backend가 AI를 켜고 가짜 AI(FAKE_AI_SPLIT=1 node scripts/fake-ai-server.mjs)를 볼 때만 돈다 - 꺼져 있으면 건너뛴다.
// PREPARE=1이면 "배정 화면 첫 진입" 시나리오(자동 칸 추천이 돌지 않는다) 하나만 돈다(나머지는 건너뛴다). 전제: reset_db → seed_sop_demo 직후(시드는 AI_AUTO_PREPARE=false),
// 가짜 AI(node scripts/fake-ai-server.mjs)를 보는 backend를 AI_ENABLED=true AI_AUTO_PREPARE=true로 띄운다. 이 backend에서는 작성자가 배정 화면에 들어갈 때마다
// 묶기 계획이 저절로 서서 다른 단계의 전제가 깨지므로 같이 돌리지 않는다. 끝에 DB가 바뀐다(분류 절반 묶음에 잇기 제안이 붙는다) - 다시 돌리려면 reset_db부터.
// 실행(frontend/ 에서): node scripts/pw-smoke-sop.mjs   환경 변수: BASE_URL, CHROME_PATH, BACKEND_PYTHON(없으면 이 체크아웃 · 원본 체크아웃의 backend/.venv를 찾는다)
// 워크트리는 scripts/dev-worktree.sh(저장소 루트)로 띄우면 시드 지문이 적혀, DB가 시드 뒤 바뀌었으면 처음에 멈춘다(DIRTY_DB_OK=1이면 그대로 돈다)
// ONLY="이름 조각,…"이면 이름에 그 조각이 든 단계만 돈다. 묶음 id를 잡는 첫 단계("bundle list")는 늘 함께 돈다. 화면 하나만 보려면 이름 머리로 고른다: ONLY="assign:" · "documents:" · "new documents:" · "outputs"
// QUIET=1이면 통과한 줄을 찍지 않는다 - 실패한 줄과 마지막 한 줄(통과 수·실패 수)만 나온다.
// 평소(변경마다)는 고친 화면만: QUIET=1 ONLY="<화면>" node scripts/pw-smoke-sop.mjs  — 전부 돌리는 것은 dev→main 정식 업데이트 전, 또는 여러 화면이 같이 쓰는 것(공용 부품·API 층·이 스크립트의 틀)을 고쳤을 때만이고 FULL=1을 붙여야 돈다(사용자 결정 2026-11-16, ONLY도 FULL도 없으면 멈춘다).
// 실패한 단계 이름은 .dev/smoke-failed.txt에 남는다. 고친 뒤에는 scripts/dev-worktree.sh reset → QUIET=1 ONLY_FAILED=1 node scripts/pw-smoke-sop.mjs 로 그 단계만 다시 돈다.
// playwright-core는 저장소 의존성이 아니다: `npm i --no-save playwright-core` (package.json 불변)
// Steps live in ./smoke/<screen>.mjs (shell · outputs · documents · order · assign · map) and shared parts in ./smoke/common.mjs.
// 새 단계는 그 화면 파일의 run() 안에 넣는다. 한 화면만 쓰는 도우미는 그 파일에, 두 화면 이상이 쓰는 것만 common.mjs에 둔다. 화면 순서는 아래 차례로 돈다.

import { browser, checkSeedFingerprint, failures, passes, runSetup, saveFailedSteps } from "./smoke/common.mjs";
import { run as runShell } from "./smoke/shell.mjs";
import { run as runOutputs } from "./smoke/outputs.mjs";
import { run as runDocuments } from "./smoke/documents.mjs";
import { run as runOrder } from "./smoke/order.mjs";
import { run as runAssign } from "./smoke/assign.mjs";
import { run as runMap } from "./smoke/map.mjs";
import { run as runPractice } from "./smoke/practice.mjs";

await checkSeedFingerprint();
await runSetup();
await runShell();
await runOutputs();
await runDocuments();
await runOrder();
await runAssign();
await runMap();
await runPractice();

await browser.close();
saveFailedSteps();
console.log(failures === 0 ? `\nALL PASS (${passes})` : `\n${failures} check(s) FAILED, ${passes} passed`);
process.exit(failures === 0 ? 0 : 1);
