# 원격 세션(클라우드 + 연결된 PC) 작업

클라우드 세션이 연결된 PC의 폴더를 다룰 때 생긴 시행착오다. 프런트 1차 작업(v0.4.0) 세션에서 실측했다. 세션이 PC의 파일을 직접 고치지 않고 클라우드에서 만든 파일을 옮겨 오는 흐름이면 먼저 읽을 것.

## ⚠️ 함정
1. **파일 전송은 비동기다 - 체크섬을 확인하고 쓴다**: 클라우드에서 PC로 파일을 보내는 도구(commit)와 그 반대(stage)는 "보냈음"을 돌려준 뒤에도 실제 쓰기가 늦게 끝날 수 있다. 같은 경로(`.shots/_patch.tgz`)로 패치를 보내고 바로 `tar xzf`로 풀었더니 **직전 회차의 파일이 풀려** 커밋마다 앞 단계 내용이 들어갔다(커밋 메시지와 내용이 한 칸씩 밀림, 푸시 전에 `commit-tree`로 다시 만들었다). 대처: 보내기 전 `sha1sum`을 적어 두고 받는 쪽에서 같은 값이 될 때까지 기다린 뒤 푼다. 회차마다 파일 이름을 바꾸면 이전 파일을 잘못 집지 않는다.
2. **다른 경로로 마운트된 워크트리는 `prunable`로 보인다 - `git worktree prune` 금지**: 워크트리의 `.git` 파일과 `worktrees/<name>/gitdir`은 PC의 절대 경로(`/Users/…`)를 가리킨다. 세션 VM은 같은 폴더를 `$HOME/mnt/<폴더>`로 보므로 `git worktree list`가 멀쩡한 워크트리를 전부 `prunable`로 표시한다. 그 자리에서 prune하면 PC의 워크트리 정보가 지워진다. git은 `GIT_DIR=$HOME/mnt/<저장소>/.git/worktrees/<name> GIT_WORK_TREE=.`로 돌리고 `-c gc.auto=0`을 붙인다(자동 gc의 prune도 막는다).
3. **git 쓰기에는 삭제 권한이 필요하다**: 연결된 폴더는 기본으로 지우기가 막혀 있는데 git은 commit·merge 때 `.git` 안의 lock 파일을 지운다. 권한 없이 쓰면 lock 파일이 남아 다음 git 명령이 "File exists"로 깨진다. git을 쓰기 전에 그 폴더(워크트리면 본 저장소 폴더도)의 삭제 권한을 먼저 받는다.
4. **PC 셸의 백그라운드 프로세스는 호출이 끝나면 죽는다**: 호출마다 새 샌드박스라 `nohup … &`로 띄운 `npm ci`·서버가 다음 호출 전에 사라진다(반쯤 깔린 `node_modules`로 타입 오류가 났다). 긴 설치는 한 호출 안에서 끝내고, 서버를 띄워 시험하는 일은 서버 기동·시험·종료를 한 스크립트로 묶는다.
5. **맥 `node_modules`는 리눅스 VM에서 돌지 않는다**: PC 셸이 리눅스 arm64 VM이면 맥에서 깐 `node_modules`의 네이티브 바이너리(swc·lightningcss·rollup)가 맞지 않아 `next build`·`vitest`가 실패한다(`Bus error`). 저장소의 `node_modules`는 그대로 두고 VM 안 별도 사본(`node_modules`·`.next` 제외 복사)에서 `npm ci`로 검증한다. 같은 이유로 `backend/.venv`도 VM 안에 따로 만든다(`uv venv -p 3.11`).
6. **브라우저 검증은 클라우드 쪽에서**: PC VM의 네트워크 허용 목록이 Playwright 브라우저 다운로드(`cdn.playwright.dev`)를 막았다. 클라우드 컨테이너에는 Chromium이 깔려 있으므로 소스를 묶어 보내 거기서 backend·frontend·스모크를 돌린다. 결과물(스크린샷)은 클라우드 `.shots/`에 남는다.
