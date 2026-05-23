# Project

**GRIP** — 전통시장 QR 결제 보안 시스템 (QR 위변조·SQL Injection·Brute Force·해시 체인 위변조 탐지/차단 데모)

**Stack:** Node.js (Express) + Supabase (PostgreSQL + Auth) + Vanilla JS + Redis  
**Event:** SOGRA 해커톤  
**Spec:** `../spec.txt` 참고 (상세 명세 원본)

---

## Current Phase

```
PHASE=0_SETUP
```

> 페이즈 변경 시 위 값만 수정한다.  
> 유효한 값: `0_SETUP` | `1_SCHEMA` | `1_SCHEMA_TEST` | `2_BACKEND` | `2_BACKEND_TEST` | `3_FRONTEND` | `3_FRONTEND_TEST` | `4_INTEGRATION`

---

## Phase Flow

```
0_SETUP → 1_SCHEMA → 1_SCHEMA_TEST → 2_BACKEND → 2_BACKEND_TEST → 3_FRONTEND → 3_FRONTEND_TEST → 4_INTEGRATION
```

TEST 페이즈는 각 구현 페이즈의 완료 기준을 검증한다.  
TEST 페이즈를 통과하지 못하면 이전 페이즈로 돌아간다.

---

## Phase Definitions

### PHASE 0: SETUP

**목표:** 프로젝트 골격 확정. 이후 페이즈에서 구조를 바꾸지 않는다.

허용:

- 폴더 구조 생성
- package.json, .env.example, .gitignore 작성
- Supabase 프로젝트 연결 및 env 확인
- CLAUDE.md 초기 작성

금지:

- 비즈니스 로직 작성
- 테이블 생성
- HTML/CSS 작성

완료 기준: `node index.js` 실행 시 서버가 뜨고 Supabase 연결이 확인된다.

---

### PHASE 1: SCHEMA

**목표:** DB 스키마 확정. 이후 페이즈에서 테이블 구조를 바꾸지 않는다.

허용:

- `supabase/migrations/` 파일 작성 및 실행
- 테이블, 컬럼, 관계, 인덱스 설계
- RLS(Row Level Security) 정책 설정
- Supabase 시드 데이터 작성

금지:

- API 라우트 작성
- HTML/CSS 작성
- 프론트엔드 파일 수정

완료 기준: Supabase 대시보드에서 모든 테이블과 RLS가 확인된다.

---

### PHASE 1_SCHEMA_TEST

**목표:** 스키마가 설계 의도대로 동작하는지 검증한다.

작성할 테스트 (`tests/schema/`):

- 모든 테이블 존재 확인
- 필수 컬럼 및 타입 확인
- RLS: 인증된 사용자만 접근 가능한 행은 anon으로 접근 시 차단되는지
- RLS: 본인 소유 데이터만 수정 가능한지
- NOT NULL 제약 조건 위반 시 에러 반환 확인
- FK 제약 조건 동작 확인

테스트 통과 기준:

- 모든 테이블과 컬럼이 명세와 일치한다
- RLS가 의도한 대로 접근을 허용/차단한다
- 제약 조건 위반 시 DB가 에러를 반환한다

실패 시: `PHASE=1_SCHEMA`로 되돌린다.

---

### PHASE 2: BACKEND

**목표:** API 전체 구현. 프론트 없이 테스트 가능한 상태.

허용:

- `routes/`, `controllers/`, `middleware/` 작성
- Supabase 클라이언트 쿼리 구현
- 인증(JWT/Supabase Auth) 미들웨어
- API 응답 포맷 통일
- HTML: semantic 구조 + class명 예약만 (내용 없는 껍데기)

금지:

- CSS 작성 (인라인 스타일 포함)
- 클라이언트 JS 비즈니스 로직
- 스타일 관련 class 속성값 확정 (이름 예약만)

프론트 작업 요청 시 처리 방법:

```html
<!-- TODO:FRONTEND - [작업 설명] -->
<button class="btn btn-primary">제출</button>
```

`.btn`, `.btn-primary` 내용은 작성하지 않는다.

완료 기준: curl 또는 Postman으로 모든 엔드포인트가 정상 응답한다.

---

### PHASE 2_BACKEND_TEST

**목표:** 모든 API 엔드포인트가 명세대로 동작하는지 검증한다.

작성할 테스트 (`tests/backend/`):

- 각 엔드포인트의 정상 응답 (status code, 응답 포맷)
- 인증 없이 보호된 엔드포인트 접근 시 401 반환
- 잘못된 입력값 시 400 반환
- 존재하지 않는 리소스 접근 시 404 반환
- 권한 없는 리소스 수정/삭제 시 403 반환
- 핵심 비즈니스 로직 동작 (예: 중복 방지, 계산 결과 등)

테스트 도구: `supertest` + `node:test` (또는 jest)

테스트 통과 기준:

- 모든 엔드포인트가 API Convention의 응답 포맷을 따른다
- 인증/인가 로직이 의도대로 동작한다
- 에러 케이스에서 적절한 HTTP 상태코드를 반환한다

실패 시: `PHASE=2_BACKEND`로 되돌린다.

---

### PHASE 3: FRONTEND

**목표:** UI 구현 및 API 연동 완성.

허용:

- `public/css/` 스타일 구현
- 클라이언트 JS (fetch/API 연동)
- HTML 마크업 보완
- UX 흐름 구현

금지:

- `routes/`, `controllers/` 수정 (버그픽스 제외)
- 새 API 엔드포인트 추가
- DB 스키마 변경

백엔드 수정이 필요할 경우:

1. 수정이 버그픽스인지 신규 기능인지 명시한다
2. 버그픽스만 허용, 신규 기능은 PHASE 4로 위임한다

완료 기준: 브라우저에서 핵심 유저 플로우가 처음부터 끝까지 동작한다.

---

### PHASE 3_FRONTEND_TEST

**목표:** 유저 플로우가 브라우저에서 실제로 동작하는지 검증한다.

작성할 테스트 (`tests/frontend/`):

- 핵심 유저 플로우 체크리스트 (수동 시나리오를 코드로 문서화)
- API 호출 함수 단위 테스트 (mock fetch 사용)
- 에러 상태 UI 표시 확인 (API 실패 시 사용자에게 메시지 노출 여부)
- 인증 상태에 따른 UI 분기 확인 (로그인/비로그인 화면 차이)
- 폼 유효성 검사 동작 확인

체크리스트 형식 (`tests/frontend/e2e-checklist.md`):

```
[ ] 비로그인 상태에서 보호된 페이지 접근 시 로그인 페이지로 이동
[ ] 로그인 후 핵심 기능 [기능명] 정상 동작
[ ] API 에러 시 사용자에게 에러 메시지 표시
[ ] [추가 시나리오]
```

테스트 통과 기준:

- 체크리스트 항목이 모두 체크된다
- API 호출 함수가 성공/실패 케이스를 올바르게 처리한다

실패 시: `PHASE=3_FRONTEND`로 되돌린다.

---

### PHASE 4: INTEGRATION

**목표:** 안정화. 새 기능 추가 없이 완성도만 높인다.

허용:

- 버그픽스
- 에러 핸들링 보완
- UI 세부 조정 (레이아웃 깨짐 등)
- README 작성

금지:

- 새 기능 추가
- 새 테이블, 새 라우트, 새 컴포넌트
- 스키마 변경

---

## Test Structure

```
tests/
├── schema/
│   └── schema.test.js       # PHASE 1_SCHEMA_TEST
├── backend/
│   ├── auth.test.js         # 인증 엔드포인트
│   └── [resource].test.js   # 리소스별 API 테스트
└── frontend/
    ├── api.test.js          # 클라이언트 API 함수 단위 테스트
    └── e2e-checklist.md     # 수동 E2E 체크리스트
```

테스트 실행:

```bash
npm test                # 전체 테스트
npm run test:schema     # 스키마 테스트만
npm run test:backend    # 백엔드 테스트만
npm run test:frontend   # 프론트엔드 테스트만
```

---

## Phase Enforcement Rules

현재 페이즈 범위 밖 작업이 요청되면:

1. 해당 작업이 현재 페이즈 범위 밖임을 한 줄로 명시한다.
2. 현재 페이즈에서 할 수 있는 준비 작업만 수행한다.
3. 범위 밖 작업은 TODO 주석으로 처리한다.
4. 진행 여부를 사용자에게 확인하지 않는다. 규칙을 따른다.

TEST 페이즈에서 실패가 발견되면:

1. 실패 항목을 목록으로 정리한다.
2. `PHASE=`를 이전 구현 페이즈로 되돌리도록 안내한다.
3. 새 기능 추가 없이 실패 항목만 수정한다.

---

## Project Structure

```
GRIP/
├── index.js
├── routes/
│   ├── auth.js
│   ├── payments.js
│   ├── security.js
│   └── dashboard.js
├── controllers/
│   ├── auth.controller.js
│   ├── payments.controller.js
│   ├── security.controller.js
│   └── dashboard.controller.js
├── middleware/
│   ├── auth.middleware.js        # JWT 검증 + req.user 주입
│   ├── rateLimit.middleware.js   # Redis 기반 IP rate limit
│   └── sqliDetect.middleware.js  # SQL 메타 문자 탐지
├── lib/
│   ├── supabase.js               # Supabase 클라이언트 싱글톤
│   ├── redis.js                  # Redis 클라이언트 싱글톤
│   ├── hmac.js                   # HMAC-SHA256 서명/검증
│   ├── hashChain.js              # SHA256 체인 계산
│   ├── haversine.js              # Haversine 거리 계산 (미터 반환)
│   └── localAI.js                # Ollama fetch 래퍼
├── services/
│   └── aiAnalyzer.js             # 대상 선정 → 컨텍스트 구성 → LLM 호출 → 결과 저장
├── public/
│   ├── css/style.css
│   ├── js/
│   │   ├── api.js                # fetch 래퍼
│   │   ├── auth.js
│   │   ├── payment.js
│   │   └── dashboard.js
│   ├── index.html                # 소비자/상인 결제 화면
│   └── dashboard.html            # 관리자 대시보드
├── tests/
│   ├── schema/schema.test.js
│   ├── backend/
│   │   ├── auth.test.js
│   │   ├── payments.test.js
│   │   └── security.test.js
│   └── frontend/
│       ├── api.test.js
│       └── e2e-checklist.md
├── .env.example
├── .gitignore
└── package.json
```

---

## Tech Constraints

- Node.js + Express
- Supabase (PostgreSQL + Auth). Storage 미사용.
- Redis (ioredis): IP rate limiting 전용
- 프론트엔드: Vanilla JS (프레임워크 없음)
- CSS: 외부 라이브러리 없음
- 차트: Chart.js (CDN)
- 지도: Leaflet.js (CDN, 선택 구현)
- 암호: Node.js 내장 `crypto` 모듈 (SHA256, HMAC-SHA256)
- 로컬 AI: Ollama + Gemma 4 (별도 설치, npm 패키지 없음, Node 내장 fetch로 호출)
  설치·사용법: gemma.txt 참고
- 외부 API: 없음 (선택 구현인 지도는 공공데이터 정적 좌표 사용)

---

## API Convention

Base path: `/api`  
인증: `Authorization: Bearer <JWT>` 헤더

응답 포맷:

```json
// 성공
{ "success": true, "data": { ... } }
// 실패
{ "success": false, "error": { "code": "ERROR_CODE", "message": "한국어 설명" } }
```

HTTP 상태코드: 200 / 201 / 400 / 401 / 403 / 404 / 429 / 500

에러 코드:

- INVALID_CREDENTIALS — 이메일/비밀번호 불일치
- ACCOUNT_LOCKED — 계정 잠금 (detail: unlock_at)
- SQLI_DETECTED — SQL Injection 탐지
- RATE_LIMITED — IP rate limit 초과
- INVALID_QR — QR 서명 불일치 또는 만료
- REPLAY_QR — 이미 사용된 QR
- INSUFFICIENT_BALANCE — 잔액 부족
- CHAIN_INVALID — 해시 체인 불일치
- UNAUTHORIZED — 인증 토큰 없음/무효
- FORBIDDEN — 역할 권한 없음

---

## Environment Variables

```
PORT=3000
NODE_ENV=development
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # 서버 전용 — 클라이언트 노출 금지
HMAC_SECRET=                 # QR 서명 키 (256비트 이상 랜덤)
MAX_DISTANCE_METERS=100      # 위치 검증 허용 반경 (미터)
REDIS_URL=redis://localhost:6379
OLLAMA_URL=http://localhost:11434   # Docker 배포 시 http://ollama:11434
OLLAMA_MODEL=gemma4                # 기본: gemma4 (4B). 저사양 시 gemma4:2b
AI_ANALYSIS_INTERVAL_MINUTES=5
GEMMA_API_KEY=                     # Google AI Studio 키 (서버 배포 대안, 전략 C)
GEMMA_API_URL=                     # Google AI Studio 엔드포인트
DISABLE_AI=false                   # true 시 AI 기능 전체 비활성화 (긴급 폴백)
# 배포 전략 선택 기준: gemma.txt 섹션 7 참고
```

---

## Key Commands

```bash
npm run dev             # nodemon으로 서버 실행
npm start               # 프로덕션 실행
npm test                # 전체 테스트
npm run test:schema     # 스키마 테스트
npm run test:backend    # 백엔드 테스트
npm run test:frontend   # 프론트엔드 테스트
```

---

## Core Features

1. **동적 서명 QR 결제** — 상인 GPS 위치 포함 HMAC-SHA256 서명 QR 발급 → 소비자 스캔 → 서버 검증 후 포인트 이체
2. **QR 위변조 탐지** — 서명 불일치(INVALID_QR) + nonce 재사용(REPLAY_QR) + 60초 만료 차단
3. **위치 기반 결제 검증** — 상인·소비자 Geolocation 동의 → Haversine 거리 계산 → 100m 초과 시 LOCATION_MISMATCH 차단
4. **SQL Injection 방어** — 로그인 요청의 SQL 메타 문자 탐지 (SQLI_BLOCKED 이벤트)
5. **Brute Force 방어** — Redis rate limit (IP당 분당 10회) + 5회 실패 시 30분 계정 잠금
6. **거래 해시 체인** — SHA256 체인으로 거래 기록 무결성 보장, 검증 API로 변조 탐지
7. **AI 이상 행동 탐지** — Ollama 로컬 LLM이 트랜잭션/이벤트 기록 분석 → 관리자에게 차단 권고 + 자연어 차단 사유 생성
8. **보안 이벤트 대시보드** — 실시간 이벤트 피드(SSE) + AI 차단 권고 패널 + Chart.js 막대 차트

AI 원칙: 보안 차단 판단은 기존 결정론적 룰 유지. AI는 패턴 요약·자연어 설명·권고 생성에만 사용.
MVP 범위 밖: Leaflet 지도 (위치 불일치 시각화), 도넛 차트 (시간 여유 시 추가)

---

## Do Not

- `console.log` 디버그 코드를 커밋에 남기지 않는다
- `.env` 파일을 커밋하지 않는다
- `SUPABASE_SERVICE_ROLE_KEY`를 클라이언트 코드에 노출하지 않는다
- 현재 페이즈 범위 밖 작업을 허락 없이 진행하지 않는다
- TEST 페이즈를 건너뛰고 다음 구현 페이즈로 넘어가지 않는다
- 기능 추가 전 기존 기능이 동작하는지 확인한다
