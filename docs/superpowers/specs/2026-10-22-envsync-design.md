# envsync 설계 문서

작성일: 2026-10-22

## 1. 의도와 배경

GitHub로 소스는 쉽게 받지만, 개발환경을 띄우려면 `.env` 같은 비밀값 파일이 필요하고 이건 레포에 올릴 수 없다. 새 PC에서 클론할 때마다 env 파일을 따로 옮기는 게 불편하다.

사용자는 이미 Bitwarden 유료(Premium) 플랜을 쓰고 있다. 직접 서버를 운영하며 비밀값을 보관하는 방식(자체 서비스)은 원하지 않는다. "내가 보관할 필요가 없고 보안이 우수한" 방식, 즉 Bitwarden을 저장소로 쓰는 로컬 CLI를 만든다.

목표 사용 흐름:

```
git clone <repo>
bw login          # 최초 1회
envsync pull      # env 파일 복원
# ... env 수정 ...
envsync push      # 변경 반영
```

## 2. 목표 / 비목표 / 실패 조건

**목표**
- Node CLI `envsync`로 레포의 env 파일들을 Bitwarden에 올리고(push) 받는다(pull).
- 레포 하나에 여러 env 파일(`.env`, `.env.local`, `.env.prod` 등, 하위 폴더 포함)과 비밀값이 든 YAML 설정 파일을 **파일별로 따로** 저장한다.
- 암호화(SOPS) 모드를 **옵션**으로 제공한다.
- 사람용 사용 설명서(README)와 AI 에이전트용 스킬(Claude Code `SKILL.md`)을 함께 제공한다.

**비목표**
- 서버/웹 서비스/계정 시스템을 만들지 않는다. Bitwarden이 유일한 원격 저장소다.
- Bitwarden Secrets Manager(`bws`) 연동은 하지 않는다 (별도 구독, 추후 CI 용도로 고려).
- 팀 공유·권한 관리·CI 연동은 1차 범위가 아니다.
- git commit/push를 대신 하지 않는다.

**실패 조건 (동작해도 실패로 보는 것)**
- 평문 비밀값이 git에 커밋되거나, 터미널 출력·로그·임시파일·셸 히스토리에 남는 것.
- 확인 없이 로컬 또는 Bitwarden의 env 내용을 덮어써 데이터가 사라지는 것.
- AI 에이전트가 스킬을 따르다가 비밀값을 대화에 출력하게 되는 것.

## 3. 제약

- 런타임: Node.js (사용자 환경 v22). 주 사용 OS는 Windows이며 macOS/Linux에서도 동작해야 한다.
- 의존 외부 프로그램: Bitwarden CLI `bw` (필수), `sops` (암호화 모드에서만 필수).
- Bitwarden Secure Note의 notes 필드는 암호화 후 약 10,000자 제한이 있다.

## 4. 사용자가 결정한 사항

- 구현 언어: **Node CLI**.
- Bitwarden **Password Manager + `bw` CLI** 사용 (Secrets Manager 아님).
- env 파일은 **파일별로 따로** 저장.
- 명령 흐름: `bw login` 후 `pull` / `push`.
- 암호화는 **옵션**: 
  - **vault 모드(기본)**: env 파일 내용을 파일별 Bitwarden 항목에 직접 저장. 레포에는 아무것도 커밋되지 않음(설정 파일 제외).
  - **sops 모드**: 각 env 파일을 SOPS로 암호화한 `.enc` 파일을 레포에 커밋하고, Bitwarden에는 **복호화 키만** 저장.
- sops 모드의 키는 **레포마다 따로** 생성.
- 암호화 도구는 dotenvx와 비교 후 **SOPS 유지**. 이유: YAML 등 .env 이외 형식에도 범용으로 쓸 수 있어서.
- 레포별 설정 파일 이름: **`.envsync.config`** (레포에 커밋, 비밀값 없음).
- 사용자 설명서 + AI 에이전트 스킬 제공.

## 5. 설계 (빌더 판단으로 정한 부분은 [판단] 표시)

### 5.1 명령 이름 [판단]
명령은 `envsync`. 원래 이야기한 `env pull`의 `env`는 macOS/Linux/Git Bash의 기본 명령 `env`와 충돌하므로 사용하지 않는다. 설정 파일 이름과도 맞춘다.

### 5.2 명령 목록 [판단]

| 명령 | 동작 |
|---|---|
| `envsync init [--encrypt]` | `.envsync.config` 생성. git remote에서 `owner/repo` 추출, 레포 안의 env 파일 자동 탐지 후 목록 기록, 평문 env 파일을 `.gitignore`에 추가. `--encrypt`면 sops 모드로 초기화하고 age 키 생성 → Bitwarden 저장. |
| `envsync push` | 설정의 파일 목록을 Bitwarden(vault) 또는 `.enc` 파일(sops)로 반영. 변경 요약 표시 후 확인. |
| `envsync pull` | Bitwarden(vault) 또는 `.enc` 파일 + Bitwarden 키(sops)로 평문 env 파일 복원. |
| `envsync status` | 파일별 상태(동기화됨 / 로컬 변경 / 원격 변경 / 로컬 없음 / 원격 없음). 값은 절대 출력하지 않음. |
| `envsync add <file>` / `envsync remove <file>` | 관리 대상 파일 추가/제외 (설정 파일 갱신 + `.gitignore` 반영). `remove`는 Bitwarden 항목을 삭제하지 않음. |

공통 옵션: `--yes`(확인 생략, 에이전트/스크립트용), `--json`(기계가 읽는 출력), `--force`(pull 시 로컬 덮어쓰기 허용).

`init` 없이 `push`를 실행하면 `init` 안내 후 종료한다. `.envsync.config`는 있지만 Bitwarden에 아무것도 없는 상태에서 `pull`하면 그 사실을 알려준다.

### 5.3 `.envsync.config` 형식 [판단]
JSON. 비밀값은 절대 들어가지 않는다.

```json
{
  "version": 1,
  "repo": "owner/repo",
  "mode": "vault",
  "files": [".env", ".env.local", "backend/.env", "frontend/.env.production"],
  "sops": { "recipient": "age1..." }
}
```

- `repo`: init 시 `git remote get-url origin`에서 추출해 고정 기록. 이후 remote가 바뀌어도 Bitwarden 항목 매칭은 이 값으로 한다 (포크/이름 변경에 안정적). remote가 없으면 사용자에게 입력받는다.
- `files`: 레포 루트 기준 상대경로, `/` 구분자로 저장 (Windows에서도).
- `sops.recipient`: sops 모드일 때만. age **공개키**라서 커밋해도 안전.

### 5.4 관리 대상 파일과 자동 탐지
**지원 형식 (사용자 결정)**: `.env` 계열 파일과 **YAML 파일(`*.yml`, `*.yaml`)**. 그 외 형식은 1차 범위 밖이며 `add` 시 거부한다.

**자동 탐지 [판단]**: `init` 시 레포 전체에서
- `.env`, `.env.*` 패턴 파일 전부
- YAML 파일 중 **git이 무시(ignore)하고 있는 것만** (예: `application-local.yml`). docker-compose나 GitHub Actions 워크플로처럼 커밋된 YAML은 비밀값 파일이 아니므로 제안하지 않는다.

를 찾는다. 공통 제외: `node_modules`, `.git`, `.env.example`/`.env.sample`/`.env.template`, `*.enc`, `*.envsync-backup`. 탐지 결과를 보여주고 확인받는다(`--yes`면 그대로 채택). 탐지되지 않은 YAML은 `envsync add <file>`로 추가한다.

**형식 판별 [판단]**: 파일 이름으로 판별. `.yml`/`.yaml` 확장자 → yaml, 나머지 → dotenv.

### 5.5 Bitwarden 저장 구조 [판단]
- 모든 항목은 Bitwarden 폴더 **`envsync`** 안에 둔다 (없으면 생성).
- 항목 타입: **Secure Note**.
- vault 모드: 파일 1개 = 항목 1개. 이름 `envsync:<owner>/<repo>:<파일경로>` (예: `envsync:kys/my-app:backend/.env`). notes 필드 = 파일 원문 그대로.
- sops 모드: 레포당 항목 1개. 이름 `envsync:<owner>/<repo>:age-key`. notes 필드 = `AGE-SECRET-KEY-...`.
- 항목 검색은 이름 **완전 일치**로 한다 (`bw list items --search`는 부분 일치이므로 결과를 이름으로 다시 거른다). 같은 이름 항목이 2개 이상이면 오류로 멈춘다.
- 크기 제한: 파일이 notes 제한을 넘으면 명확한 오류로 멈추고 sops 모드를 권한다. (첨부파일 방식은 1차 범위에서 제외.)

### 5.6 sops 모드 상세 [판단]
- 키 생성은 npm 패키지 `age-encryption`(typage)으로 Node 안에서 한다 → `age` 바이너리 설치 불필요. `sops`만 필요.
- 암호화 파일: 원본 옆에 `<파일>.enc` (예: `backend/.env.local.enc`). SOPS dotenv 형식(`--input-type dotenv --output-type dotenv`)이라 키 이름은 평문, 값만 암호화 → git diff로 어떤 변수가 바뀌었는지 보인다.
- 암호화: `sops encrypt --age <recipient> ...`. 암호화 자체는 공개키만 있으면 되지만, 변경 요약(5.8)과 "변경 없으면 재암호화 안 함" 판단에 기존 `.enc` 복호화가 필요하므로 **sops 모드의 push도 Bitwarden 잠금 해제가 필요**하다 [판단]. 두 모드 모두 push/pull은 잠금 해제를 요구하는 것으로 통일한다.
- **형식 선택 [판단]**: SOPS는 dotenv 파일을 `--input-type dotenv`, YAML 파일을 `--input-type yaml`로 암호화한다(키는 평문, 값만 암호화). 하지만 SOPS는 dotenv의 여러 줄 값·따옴표·주석·빈 줄·순서, YAML의 주석 위치·앵커·들여쓰기 스타일 등을 그대로 보존하지 못할 수 있다. 그래서 push할 때 파일마다 "해당 형식으로 암호화 → 복호화 → 원문과 바이트 단위 비교"를 한다. 같으면 그 형식을 쓰고, 다르면 해당 파일만 `--input-type binary`로 바꾸고 경고한다(이 경우 git diff에 키 이름이 보이지 않음). 파일별 형식은 `.envsync.config`의 `formats`(예: `{"backend/.env": "binary"}`)에 기록한다. pull은 항상 원문을 바이트 단위로 복원한다.
- 복호화: Bitwarden에서 개인키를 받아 **환경변수 `SOPS_AGE_KEY`로만** sops 자식 프로세스에 전달. 키를 디스크에 쓰지 않는다.
- `push`(sops 모드)는 `.enc` 파일만 갱신하고, 커밋하라는 안내를 출력한다.
- 값이 바뀌지 않았는데 매번 `.enc`가 재암호화되어 diff가 생기지 않도록, 기존 `.enc`를 복호화해 평문과 같으면 건드리지 않는다.

### 5.7 인증/세션 [판단]
- `bw status`로 상태 확인.
  - `unauthenticated` → `bw login` 하라는 안내 후 종료 (로그인은 대신 하지 않음).
  - `locked` → `BW_SESSION` 환경변수가 있으면 사용. 없으면 마스터 비밀번호를 **숨김 입력**으로 받아 `bw unlock --passwordenv`로 넘겨 세션 토큰을 얻는다. 비밀번호/토큰은 프로세스 메모리에만 두고 파일에 저장하지 않는다.
  - 비대화형(TTY 아님)인데 잠겨 있으면 프롬프트 없이 오류로 종료하고 `BW_SESSION` 설정 방법을 안내한다 (에이전트용).
- `pull`/`status` 전에 `bw sync`를 실행해 다른 PC의 변경을 반영한다.

### 5.7.1 마지막 동기화 상태 [판단]
`status`와 push 충돌 감지를 위해 마지막 동기화 상태를 **로컬 `.git/envsync/state.json`**에 기록한다(`.git` 안이라 커밋되지 않음). 파일별로 마지막 push/pull 시점의 내용 해시(SHA-256)와 원격 버전 표시(vault: Bitwarden 항목 `revisionDate`, sops: `.enc` 파일 해시)를 저장한다. **값은 저장하지 않는다.**
- 로컬 해시 ≠ 기록 → "로컬 변경". 원격 버전 ≠ 기록 → "원격 변경". 둘 다 → "충돌".
- push 시 원격이 마지막 동기화 이후 바뀌었으면(다른 PC에서 push함) 충돌로 멈추고 먼저 pull하라고 안내한다. `--force`일 때만 덮어쓴다.
- 상태 파일이 없으면(새 클론) 첫 pull/push 때 만든다. 이때는 비교 기준이 없으므로 5.8의 내용 비교만으로 판단한다.

### 5.8 덮어쓰기 안전장치 [판단]
- **push**: 원격(Bitwarden 또는 `.enc`)과 로컬을 비교해 파일별로 "추가된 키 / 삭제된 키 / 값이 바뀐 키" **이름만** 보여주고 확인받는다. 변경 없는 파일은 건너뛴다.
- **pull**: 로컬 파일이 없으면 바로 생성. 로컬 파일이 있고 내용이 다르면:
  - **fast-forward (사용자 결정, 2026-10-22 개정)**: 동기화 상태 기록이 있고 로컬 파일 해시가 기록과 같으면(마지막 동기화 이후 로컬을 고치지 않음) `--force` 없이 원격 내용으로 갱신한다. git의 fast-forward와 같은 개념이며 백업은 만들지 않는다.
  - 그 외(로컬을 고쳤거나 기록이 없음)에는 차이(키 이름만)를 보여주고 건너뛴다. `--force`일 때만 덮어쓰며, 그때 기존 파일을 `<파일>.envsync-backup`으로 남기고 이 패턴도 `.gitignore`에 추가한다.
  - 별도 `fetch` 명령은 두지 않는다. 원격 변경 확인은 `status`(`bw sync` 후 `remote-changed`)가 담당한다.
- 키 비교 단위 [판단]: dotenv는 변수 이름, YAML은 점으로 이은 키 경로(예: `db.password`, 배열은 `servers[0].host`). YAML 파싱에 실패하면 "내용 변경됨"으로만 표시한다.
- 출력 어디에도 값은 나오지 않는다.

### 5.9 .gitignore 처리 [판단]
`init`/`add` 시 관리 대상 평문 파일 경로와 `*.envsync-backup`을 `.gitignore`에 추가한다(이미 무시되고 있으면 생략, `git check-ignore`로 확인). 이미 git에 추적 중인 평문 env 파일이 있으면 경고하고 `git rm --cached` 방법을 안내한다(직접 실행은 안 함).

### 5.10 기술 스택 [판단]
- TypeScript → 빌드 결과를 npm `bin`으로 노출.
- 인자 파싱: `commander`. 키 생성: `age-encryption`. YAML 키 경로 비교: `yaml`. 그 외 의존성은 최소화.
- 외부 명령(`bw`, `sops`, `git`)은 `child_process.spawn`/`execFile`로 **셸 없이** 호출 (인자 이스케이프 문제·인젝션 방지). Windows에서는 `bw.cmd`(npm 설치) / `bw.exe`(winget 설치) 모두 찾아야 한다.
- 비밀값은 표준입력/환경변수로 넘기고 커맨드라인 인자로 넘기지 않는다 (프로세스 목록 노출 방지). 예: `bw create item`에 넣을 JSON은 `bw encode`로 처리하되 stdin으로 전달.
- 테스트: `bw`/`sops` 호출부를 인터페이스로 분리해 가짜 구현으로 단위 테스트. sops가 설치된 환경에서만 도는 통합 테스트는 선택.
- 설치/배포: 1차는 GitHub 레포에서 `npm i -g <레포>` 또는 로컬 `npm link`. npm 공개 배포는 추후.

### 5.11 사용 설명서 [판단]
`README.md`를 **한국어**로 작성: 설치(`bw`, `sops`, envsync), 첫 설정(`init`), 새 PC에서 복원, 모드 비교와 선택 기준, 명령/옵션 표, 문제 해결(잠금, 크기 초과, 충돌).

### 5.12 AI 에이전트 스킬 [판단]
레포에 `skills/envsync/SKILL.md` (Claude Code 스킬 형식) 제공 + README에 설치 방법(`~/.claude/skills/`로 복사) 안내. 내용:
- 언제 쓰는지 (env 파일이 없어서 실행이 안 될 때, env 변경 후 반영할 때).
- 에이전트는 항상 `--json` 사용, `push`/`--force`는 사용자 확인 후에만.
- **env 파일 내용과 `.enc` 복호화 결과를 절대 읽거나 출력하지 않는다.** `status`로만 확인.
- **세션 처리 (사용자 결정: A안)**: 에이전트는 실행 환경에 `BW_SESSION`이 이미 있을 때만 push/pull을 실행한다(사용자가 Claude Code 실행 전 터미널에서 잠금 해제·export 해둔 경우). 잠겨 있으면 envsync는 비대화형 오류(전용 종료 코드)로 끝나고, 에이전트는 마스터 비밀번호나 세션 토큰을 묻거나 받지 말고 "별도 터미널에서 `envsync pull`을 직접 실행해 달라"고 안내한다. 세션 토큰을 OS 보관소 등에 캐시하는 기능은 만들지 않는다.
- `--json` 출력 스키마와 종료 코드 표.

## 6. 빌더에게 맡기는 부분
- 내부 모듈 구조, 파일 배치, 함수 이름.
- 출력 문구와 색상 (한국어 메시지 권장).
- dotenv 파싱 세부 (주석, 따옴표, 여러 줄 값 처리 — 비교용이므로 원문 보존이 우선, 비교는 키/값 단위).
- `--json` 출력의 구체적 필드명과 종료 코드 번호 (스킬 문서와 일치만 하면 됨).
