"""AI 층의 수치 — 후보 수·유사도 임계값·요청 상한·재시도. 임계값은 합성 자료로만 잡은 값이라 실제 모델 시험 뒤 다시 정한다."""

# --- 후보 추리기 ---
CANDIDATE_TOP_K = 3  # 단위 하나에 LLM으로 보내는 칸 후보 수 — 늘리면 프롬프트가 커지고 고르기가 흐려진다
MAX_TEXT_CANDIDATES = 20  # 임베딩 없이 글자 유사도로 볼 때의 후보 상한

# --- 유사도 임계값(0~1) ---
MATCH_EMBED_THRESHOLD = 0.75  # 입구 2 임베딩 유사도 — 낮추면 옛·새 짝이 늘고 오답도 는다
MATCH_TEXT_THRESHOLD = 0.5  # 입구 2 글자 유사도(임베딩이 꺼져 있을 때)
PAIR_THRESHOLD = 0.7  # 한/영 따로 짝 제안의 임베딩 유사도

# --- 임베딩 ---
EMBED_BATCH_SIZE = 64  # /embeddings 한 번에 보내는 글 수
MAX_EMBED_CHARS = 2000  # 글 하나를 임베딩에 보낼 때 자르는 글자 수

# --- 요청 상한 ---
MAX_JOBS_PER_REQUEST = 2000  # 요청 한 번이 쌓는 작업 수 — 넘은 단위는 limit_reached로 알린다
MAX_SKIPPED_REPORTED = 200  # 응답의 skipped·unit_not_found에 싣는 앞쪽 건수(전체 수는 skipped_total·missing_total)
DEFAULT_SUGGESTIONS_PAGE = 200  # GET /suggestions 한 쪽 기본 건수
MAX_SUGGESTIONS_PAGE = 1000  # GET /suggestions 한 쪽 상한

# --- 실행기·재시도 ---
AI_POLL_SECONDS = 2.0  # 워커가 빈자리·새 작업을 기다리는 주기(초)
AI_CALL_ATTEMPTS = 3  # AI 호출 한 번의 총 시도 수
AI_RETRY_DELAYS = (1.0, 3.0)  # 재시도 사이 대기(초) — 길이는 AI_CALL_ATTEMPTS-1
MAX_JOB_ATTEMPTS = 3  # 작업이 재시작으로 끊겨도 다시 꺼내는 횟수 — 채우면 failed(interrupted)

# --- 내용 규칙 ---
MIN_SPLIT_CHARS = 60  # 이보다 짧은 문장은 복합 문장 나누기를 제안하지 않는다(문서 범위 요청만, 고른 단위는 길이를 보지 않는다)
MAX_SPLIT_PARTS = 10  # 복합 문장 하나를 나누는 조각 수 상한 — 넘는 응답은 무효다(저장하지 않는다)
NEIGHBOR_UNITS = 2  # 맥락으로 앞뒤에 함께 보내는 단위 수(한쪽 기준)
MAX_REWRITE_SENTENCES = 5  # 단위 하나를 고쳐 쓸 때 언어별 최대 문장 수
MAX_AI_TEXT_CHARS = 20000  # AI 응답 글자 한 칸의 상한 — 사람이 저장하는 TargetIn.text 상한과 같아야 그대로 확정할 수 있다
MAX_TABLE_CONTEXT_ROWS = 200  # 표 맥락(Markdown)에 싣는 앞쪽 행 수 — 넘는 행은 버린다
MAX_TABLE_CONTEXT_COLS = 50  # 표 맥락에 싣는 앞쪽 열 수 — 넘는 열은 버린다
MAX_TABLE_CONTEXT_CHARS = 20000  # 표 맥락 Markdown의 글자 상한 — 넘으면 뒤를 잘라 표 하나가 프롬프트를 채우지 않게 한다
