# envsync

`.env`와 YAML 비밀값 파일은 git에 올릴 수 없어서 새 PC나 새 클론에서 앱이 실행되지 않는 일이 생깁니다. `envsync`는 이런 파일을 Bitwarden(선택: SOPS 암호화)과 동기화해서, 클론한 뒤 `envsync pull` 한 번으로 복원할 수 있게 해 줍니다.

## 목차

1. [설치](#설치)
2. [처음 설정](#처음-설정)
3. [새 PC에서 복원](#새-pc에서-복원)
4. [모드 비교](#모드-비교)
5. [명령과 옵션](#명령과-옵션)
6. [종료 코드](#종료-코드)
7. [Bitwarden 저장 구조](#bitwarden-저장-구조)
8. [문제 해결](#문제-해결)
9. [AI 에이전트에서 쓰기](#ai-에이전트에서-쓰기)

## 설치

필요한 것: Node.js 22.12 이상, Bitwarden CLI(`bw`), git. SOPS 모드를 쓸 때만 `sops` 3.9 이상이 더 필요합니다.

> AI 에이전트에게 설치를 맡기려면 이렇게 요청하세요: "`https://github.com/gys316/env-manager/blob/main/INSTALL.md`를 읽고 envsync를 설치해줘." 에이전트는 [INSTALL.md](INSTALL.md) 절차대로 설치하고, Bitwarden 로그인·잠금 해제만 직접 하도록 안내합니다.


**1. Bitwarden CLI**

```
winget install --id Bitwarden.CLI -e     # Windows
brew install bitwarden-cli               # macOS
npm i -g @bitwarden/cli                  # 공통
```

**2. sops 3.9 이상 (SOPS 모드를 쓸 때만)**

```
winget install --id SecretsOPerationS.SOPS -e   # Windows
brew install sops                               # macOS
# Linux: https://github.com/getsops/sops/releases 에서 바이너리를 받아 PATH에 둡니다
```

**3. envsync CLI**

```
npm i -g github:gys316/env-manager
# 또는 클론한 폴더에서
npm install && npm run build && npm link
```

**4. Claude Code 스킬 (선택)**

```
npx skills add gys316/env-manager --skill envsync -a claude-code -g
```

`-g`는 사용자 전체(`~/.claude/skills`)에 설치하고, 빼면 현재 프로젝트의 `.claude/skills`에 설치합니다. 클론한 폴더가 있으면 `gys316/env-manager` 대신 경로를 넣어도 됩니다(`npx skills add ./env-manager --skill envsync -a claude-code -g`). 업데이트는 `npx skills update envsync`, 제거는 `npx skills remove envsync`입니다.

**설치 확인**

```
envsync --version
bw --version
sops --version --disable-version-check   # SOPS 모드를 쓸 때만
```

Windows에서 winget으로 설치한 직후 명령을 찾지 못하면 터미널을 새로 여세요.

## 처음 설정

레포 루트(또는 하위 폴더)에서 실행합니다.

```
bw login
envsync init          # .env 계열과 .yml/.yaml 파일을 자동으로 찾아 설정 파일을 만듭니다
envsync push          # Bitwarden에 올립니다
git add .envsync.config .gitignore
git commit -m "chore: envsync"
```

`.envsync.config`와 `.gitignore` 변경은 꼭 커밋하세요. 새 PC에서 클론한 레포에 `.envsync.config`가 없으면 `pull`이 무엇을 받아야 할지 모릅니다.

SOPS 모드로 쓰려면 `init`에 `--encrypt`를 붙입니다. push하면 원본 옆에 `<파일>.enc`가 생기므로 이 파일을 커밋하세요. push가 어떤 파일을 `binary` 형식으로 바꾸면 `.envsync.config`(`formats`)도 바뀌므로 `.enc`와 함께 커밋해야 합니다(push가 커밋할 파일 목록을 알려 줍니다).

```
envsync init --encrypt
envsync push
git add .envsync.config "*.enc" .gitignore .gitattributes
git commit -m "chore: envsync"
```

`init`이 하는 일:

- `.envsync.config`(JSON, 비밀값 없음, 커밋 대상)를 만듭니다.
- 관리하는 파일, `*.envsync-backup*`, `*.enc.tmp`를 `.gitignore`에 추가합니다.
- 끝나면 커밋할 파일(`.envsync.config`, `.gitignore`, SOPS 모드는 `.gitattributes`까지)을 알려 줍니다.
- SOPS 모드이면 `.gitattributes`에 `*.enc -text`를 추가하고, age 키를 만들어 Bitwarden에 저장합니다(이미 있으면 재사용).
- 관리 대상 파일이 이미 git에 추적 중이면 `git rm --cached <파일>`을 실행하라고 경고합니다.

## 새 PC에서 복원

```
git clone <레포 주소>
cd <레포>
bw login
envsync pull
```

잠금이 풀려 있지 않으면 터미널에서 마스터 비밀번호를 묻습니다(입력은 화면에 표시되지 않습니다). 하위 폴더에서 실행해도 레포 루트 기준으로 동작하고, 받을 파일의 상위 폴더가 없으면 만들어 줍니다. 받은 파일이 레포의 `.gitignore`에 없으면 추가하고 알려 주니, 그 `.gitignore` 변경을 커밋하세요.

## 모드 비교

| | vault (기본) | sops (`--encrypt`) |
|---|---|---|
| 레포에 남는 것 | `.envsync.config`만 | `.envsync.config` + `<파일>.enc` (암호문) |
| 값이 저장되는 곳 | Bitwarden 보안 노트 | `.enc` 파일 (개인키는 Bitwarden) |
| 변경 이력 | 없음 (Bitwarden 항목 이력에만 의존) | git 이력에 남음 (키 이름 단위로 diff) |
| 크기 제한 | 파일당 7000바이트(UTF-8) | 사실상 없음 |
| 필요한 프로그램 | `bw` | `bw` + `sops` 3.9 이상 |

SOPS 모드 참고:

- envsync는 레포의 `.sops.yaml`과 격리된 자체 설정으로 sops를 호출하므로 레포의 creation rule이 envsync 파일에 영향을 주지 않습니다.
- SOPS가 그대로 복원하지 못하는 파일(여러 줄 dotenv 값, YAML 주석/앵커)은 자동으로 `binary` 형식으로 암호화되고 `.envsync.config`의 `formats`에 기록됩니다. 이 경우 git diff에 키 이름이 보이지 않습니다.

## 명령과 옵션

```
envsync [전역 옵션] <명령>
```

| 명령 | 설명 |
|---|---|
| `init [--encrypt] [--repo <owner/repo>]` | 레포에서 envsync를 초기화합니다. `--encrypt`는 SOPS(age) 모드, `--repo`는 origin remote가 없거나 해석할 수 없을 때 레포 이름을 직접 지정합니다. |
| `push` | 로컬 파일을 Bitwarden(SOPS 모드는 `.enc`)에 올립니다. 올리기 전에 키 이름 요약을 보여주고 확인을 받습니다. |
| `pull` | Bitwarden의 파일을 내려받습니다. 마지막 동기화 이후 로컬을 고치지 않은 파일은 원격 내용으로 바로 갱신하고(fast-forward, 백업 없음), 로컬을 고쳤거나 동기화 기록이 없는데 내용이 다른 파일은 건너뜁니다. |
| `status` | 로컬과 Bitwarden의 동기화 상태를 봅니다. |
| `add <file>` | 관리할 파일을 추가합니다. `.env` 계열 또는 `.yml`/`.yaml`만 가능합니다. |
| `remove <file>` | 관리 목록에서 파일을 뺍니다. Bitwarden 항목과 `.gitignore` 항목은 그대로 둡니다. |

전역 옵션:

| 옵션 | 설명 |
|---|---|
| `--yes` | 확인 없이 진행합니다. |
| `--json` | stdout에 JSON 한 줄만 출력합니다(사람이 읽는 글은 stderr). 항상 비대화형으로 동작하므로 비밀번호나 확인을 묻지 않습니다. |
| `--force` | `push`는 충돌 검사를 건너뛰고 덮어쓰며, `pull`은 로컬 파일을 `<파일>.envsync-backup`으로 백업한 뒤 덮어씁니다(이미 다른 내용의 백업이 있으면 `<파일>.envsync-backup-<YYYYMMDDHHmmss>`에 새로 남깁니다). 마지막 동기화 이후 로컬을 고치지 않은 파일은 `--force`여도 백업 없이 fast-forward됩니다(잃을 로컬 변경이 없음). |

출력에는 파일 경로와 키 이름(`+추가`, `~변경`, `-삭제`)까지만 나오고 값은 나오지 않습니다.

## 종료 코드

| exit | code | 의미 |
|---|---|---|
| 0 | — | 성공 |
| 1 | `UNEXPECTED` | 예상하지 못한 오류 |
| 2 | `NOT_INITIALIZED` / `USAGE` / `NOT_GIT_REPO` / `ALREADY_INITIALIZED` / `UNSUPPORTED_FILE` | 설정 없음, 사용법 오류 |
| 3 | `NOT_LOGGED_IN` | `bw login` 필요 |
| 4 | `VAULT_LOCKED` | 잠겨 있고 비대화형이라 잠금을 풀 수 없음 |
| 5 | `CONFLICT` | 원격이 마지막 동기화 이후 바뀌었거나, 기준 없이 내용이 다름 |
| 6 | `PULL_SKIPPED` | 로컬에서 고친(또는 동기화 기록이 없는) 파일이 원격과 달라 pull에서 건너뜀 |
| 7 | `MISSING_DEPENDENCY` | `bw`/`sops`가 없거나 sops 버전이 3.9 미만 |
| 8 | `CONFIRMATION_REQUIRED` | 비대화형인데 `--yes` 없이 확인이 필요한 작업 |
| 9 | `NOTE_TOO_LARGE` / `DUPLICATE_ITEM` / `BW_ERROR` / `SOPS_ERROR` | 저장소 쪽 오류 |

## Bitwarden 저장 구조

- 폴더 `envsync` 아래에 보안 노트(Secure Note)로 저장합니다.
- 항목 이름: `envsync:<owner>/<repo>:<파일경로>` (예: `envsync:me/app:backend/.env`).
- SOPS 모드의 개인키 항목: `envsync:<owner>/<repo>:age-key`.
- 이름이 완전히 일치하는 항목을 찾으며, 같은 이름이 둘 이상이면 `DUPLICATE_ITEM`으로 멈춥니다.
- 동기화 상태(해시와 원격 버전만, 값은 없음)는 `<git-dir>/envsync/state.json`에 저장합니다.

## 문제 해결

**잠김 / `BW_SESSION`** (`VAULT_LOCKED`, `NOT_LOGGED_IN`)
`NOT_LOGGED_IN`이면 `bw login`을 먼저 하세요. 잠겨 있으면 일반 터미널에서 `envsync pull`을 실행해 비밀번호를 입력하거나, 세션 토큰을 환경변수로 설정합니다.

```
# PowerShell
$env:BW_SESSION = (bw unlock --raw)
# bash / zsh
export BW_SESSION=$(bw unlock --raw)
```

**`NOTE_TOO_LARGE`**
vault 모드는 파일당 7000바이트까지입니다. `envsync init --encrypt`로 SOPS 모드를 쓰세요. 이미 초기화한 레포는 `.envsync.config`를 지우고 다시 `init --encrypt` 하세요.

**`CONFLICT`**
마지막 동기화 이후 원격이 바뀌었거나, 동기화 기록 없이 내용이 다릅니다. 먼저 `envsync pull`로 최신을 받아 확인한 뒤 다시 push하세요. 로컬이 맞다고 확신할 때만 `envsync push --force`를 쓰세요.

**`PULL_SKIPPED`**
마지막 동기화 이후 이 PC에서 로컬 파일을 고쳤거나(새 클론처럼 동기화 기록이 없는 경우 포함) 그 내용이 Bitwarden과 달라 건너뛴 파일이 있다는 뜻입니다. 로컬을 고치지 않았다면 다른 PC의 변경은 `envsync pull`이 `--force` 없이 그대로 받아옵니다. 어떤 키가 다른지 출력을 확인하고, 원격으로 덮어써도 되면 `envsync pull --force`를 실행하세요. 기존 파일은 `<파일>.envsync-backup`으로 남습니다(이전 백업과 내용이 다르면 `<파일>.envsync-backup-<시각>`). 별도 `fetch` 명령은 없습니다. pull 전에 원격만 바뀐 파일을 보려면 `envsync status`(`remote-changed`)를 쓰세요. 양쪽 다 바뀐 파일은 `conflict`로 표시됩니다.

**UTF-8 텍스트가 아님 (`UNSUPPORTED_FILE`)**
vault 모드는 파일을 텍스트 노트로 저장하므로 UTF-8만 받습니다. Windows PowerShell 5.1의 `>` 리디렉션은 UTF-16으로 저장하니, 편집기에서 UTF-8로 다시 저장하거나 `envsync init --encrypt`(SOPS 모드)를 쓰세요.

**`.enc` 복호화 실패 (`SOPS_ERROR`)**
다른 PC에서 push가 `binary`로 바꾼 `.envsync.config`를 커밋하지 않았으면 형식이 맞지 않습니다. pull은 이 경우 `binary`로 다시 시도하고 경고합니다. 그래도 실패하면 `.envsync.config`가 `.enc`와 함께 커밋되었는지, Bitwarden의 age 키가 이 레포의 키인지 확인하세요.

**binary 대체 경고**
SOPS가 형식을 그대로 보존하지 못해 `binary`로 암호화했다는 경고입니다. 동작에는 문제가 없지만 git diff에 키 이름이 보이지 않습니다.

**이미 커밋된 `.env`**
`init`/`add`가 경고하면 추적만 해제하세요(파일은 남습니다). 이미 이력에 들어간 비밀값은 키를 교체해야 안전합니다.

```
git rm --cached backend/.env
```

## AI 에이전트에서 쓰기

Claude Code용 스킬이 `skills/envsync`에 들어 있습니다. [설치](#설치)의 4번처럼 `npx skills`로 설치합니다.

```
npx skills add gys316/env-manager --skill envsync -a claude-code -g
```

`npx skills`를 쓸 수 없으면 폴더를 직접 복사해도 됩니다(`skills/envsync` → `~/.claude/skills/envsync`).

에이전트는 마스터 비밀번호나 세션 토큰을 받지 않으므로, Claude Code를 실행하기 전에 같은 터미널에서 먼저 잠금을 풀어 두세요.

```
# PowerShell
$env:BW_SESSION = (bw unlock --raw)
# bash / zsh
export BW_SESSION=$(bw unlock --raw)
```

스킬은 항상 `--json`으로 실행하고, 비밀값 파일 내용은 읽거나 출력하지 않으며, `push` / `pull --force` / `--yes`는 변경 요약(키 이름)을 보여주고 승인을 받은 뒤에만 실행합니다.
