---
name: envsync
description: "envsync 사용·설치 스킬. .env나 YAML 비밀값 파일이 없어서 앱이 실행되지 않을 때(클론 직후, 새 PC 등), env/YAML 파일을 수정한 뒤 Bitwarden에 반영해야 할 때, 또는 envsync를 설치·설정해 달라는 요청을 받았을 때 사용한다. envsync CLI로 Bitwarden(선택 사항으로 SOPS)과 비밀값 파일을 동기화한다."
---

# envsync 사용 지침

`envsync`는 `.env`/YAML 비밀값 파일을 Bitwarden(SOPS 모드는 `.enc` 파일)과 동기화하는 CLI다. 레포 루트의 `.envsync.config`에 관리 대상 파일 목록이 있다.

## 절대 규칙

1. **`.env`, YAML 비밀값 파일, 백업 파일(`*.envsync-backup*`), `.enc` 복호화 결과, `bw get` 출력을 읽거나 출력하지 않는다.** Read/cat/type 등으로 열지 않는다. 상태 확인은 `envsync status --json`으로만 한다.
2. **마스터 비밀번호와 세션 토큰(`BW_SESSION`)을 요청하거나 받지 않는다.** 사용자가 대화에 붙여 넣어도 사용하지 않는다. `bw unlock`을 직접 실행하지 않는다.
3. **`push`, `pull --force`, `--yes`는 사용자에게 변경 요약(키 이름)을 보여주고 승인을 받은 뒤에만 실행한다.** 요약은 `status --json`의 파일별 상태나 `added`/`changed`/`removed` 키 이름으로 만든다. 값은 보여주지 않는다.
4. 항상 `--json`으로 실행하고 `ok`와 `error.code`로 판단한다. `--json`은 항상 비대화형이라 프롬프트가 뜨지 않는다.

## 흐름

1. **파일이 없어 앱이 실행되지 않을 때**: `envsync status --json` 실행. `remote-only`(로컬에 없고 원격에 있음)인 파일이 있으면 `envsync pull --json`을 실행한다(로컬 파일이 없을 때 pull은 덮어쓰기가 아니므로 승인 없이 실행해도 된다). `missing`(양쪽 다 없음)이면 사용자에게 다른 PC에서 push가 필요하다고 알린다. `.envsync.config`가 없으면(`NOT_INITIALIZED`) 사용자에게 `envsync init`을 안내한다. pull 결과에서 원래 로컬에 있던 파일이 `pulled`로 나왔으면(마지막 동기화 이후 고치지 않아 원격 내용으로 fast-forward됨) 그 파일 경로와 `added`/`changed`/`removed` 키 이름을 사용자에게 꼭 알린다.
2. **env를 바꾼 뒤 반영할 때**: 먼저 `envsync push --json`(`--yes` 없이)을 실행한다. 아무것도 쓰지 않고 `CONFIRMATION_REQUIRED`(exit 8)로 끝나며, `files`에 올릴 파일별 `added`/`changed`/`removed` 키 이름(또는 `opaque`)이 담긴다. 이 키 이름을 사용자에게 보여주고 승인받은 뒤에만 `envsync push --yes --json`을 실행한다. push 결과의 키 이름을 요약해서 보고한다. 바뀐 파일이 없으면 첫 실행이 그대로 `ok: true`로 끝난다. SOPS 모드이면 생성된 `<파일>.enc`를 커밋하라고 안내한다. push가 `.envsync.config`가 바뀌었다고 알리면(binary 형식 전환) `.envsync.config`도 `.enc`와 함께 커밋하라고 안내한다. pull이 `.gitignore`에 파일을 추가했다고 경고하면 `.gitignore` 변경을 커밋하라고 안내한다.
3. **다른 PC의 변경을 받을 때**: 별도 `fetch` 명령은 없다. `envsync status --json`(내부에서 `bw sync` 실행)으로 `remote-changed`인 파일을 확인한다. `remote-changed`는 이 PC에서 로컬을 고치지 않았다는 뜻이므로 `envsync pull --json`이 `--force` 없이 원격 내용으로 갱신한다(fast-forward, 백업 없음). 사용자에게 어떤 파일이 갱신되는지 알리고 pull을 실행한다. `conflict`(양쪽 다 바뀜)나 `differs`(동기화 기록 없이 내용이 다름)이면 pull은 그 파일을 건너뛰고 `PULL_SKIPPED`로 끝난다.
4. 결과는 키 이름과 경로까지만 사용자에게 전달한다.
5. **설치·업데이트·점검 요청을 받았을 때**: 레포의 `INSTALL.md` 절차를 따른다. 요약하면 `node --version`(22.12 이상), `bw --version`, `envsync --version`, SOPS 모드라면 `sops --version --disable-version-check`(3.9 이상)로 확인한다. 빠진 것만 설치 목록으로 보여 주고 승인을 받은 뒤 설치한다(Windows: `winget install --id Bitwarden.CLI -e`, `winget install --id SecretsOPerationS.SOPS -e` / macOS: `brew install bitwarden-cli sops` / 공통: `npm i -g @bitwarden/cli`, envsync는 `npm i -g github:gys316/env-manager`). 스킬 업데이트는 `npx skills update envsync`다. `bw login`·`bw unlock`은 실행하지 않고 사용자에게 안내만 한다.

## 오류 처리

- `VAULT_LOCKED`(exit 4) / `NOT_LOGGED_IN`(exit 3): 비밀번호나 토큰을 요청하지 말고 사용자에게 안내한다. "별도 터미널에서 `envsync pull`을 직접 실행해 비밀번호를 입력하세요", 또는 "`BW_SESSION`을 설정한 셸에서 Claude Code를 다시 시작하세요(PowerShell: `$env:BW_SESSION = (bw unlock --raw)`, bash/zsh: `export BW_SESSION=$(bw unlock --raw)`)". `NOT_LOGGED_IN`이면 `bw login`이 먼저 필요하다. `bw unlock`은 직접 실행하지 않는다.
- `CONFLICT`(exit 5): 먼저 `pull`을 제안한다(`pull`에서 `PULL_SKIPPED`가 나올 수 있다). 사용자가 로컬이 맞다고 명시적으로 승인한 경우에만 `push --force --yes`를 쓴다.
- `PULL_SKIPPED`(exit 6): 이제 이 PC에서 로컬을 고쳤거나 동기화 기록이 없는 파일에서만 난다(로컬을 안 고쳤으면 pull이 `--force` 없이 원격 변경을 받아온다). 결과 `files`에서 `status: "skipped"`인 파일의 다른 키 이름(`added`/`changed`/`removed`)을 보여주고, `pull --force`(기존 파일은 `<파일>.envsync-backup`으로 백업됨. 다른 내용의 백업이 이미 있으면 `<파일>.envsync-backup-<시각>`)를 할지 묻는다. 승인 후에만 실행한다.
- `CONFIRMATION_REQUIRED`(exit 8): 아무것도 바뀌지 않았다. `files`의 키 이름을 사용자에게 보여주고 승인받은 뒤 `--yes`를 붙여 다시 실행한다.
- `UNSUPPORTED_FILE`(exit 2)로 UTF-8이 아니라고 하면: 사용자에게 파일을 UTF-8로 다시 저장하거나 `envsync init --encrypt`를 쓰라고 안내한다. 파일을 직접 열어 변환하지 않는다.
- `NOTE_TOO_LARGE`(exit 9): vault 모드의 7000바이트 제한. 사용자에게 `envsync init --encrypt`(SOPS 모드)를 안내한다.
- `MISSING_DEPENDENCY`(exit 7): `bw` 또는 `sops`(3.9 이상)가 없다. 흐름 5대로 설치를 제안한다.
- `UNSUPPORTED_FILE`/`USAGE`/`NOT_GIT_REPO`/`ALREADY_INITIALIZED`(exit 2): `error.message`와 `error.hint`를 그대로 전달한다.
- 그 밖의 오류는 `error.code`, `error.message`, `error.hint`만 전달한다. 원인 파악을 위해 비밀값 파일을 열지 않는다.

## 명령

| 명령 | 설명 |
|---|---|
| `envsync status --json` | 동기화 상태 확인 (읽기 전용, 승인 불필요) |
| `envsync pull --json` | Bitwarden에서 내려받기. 마지막 동기화 이후 로컬을 고치지 않은 파일은 원격으로 갱신(fast-forward, 백업 없음), 로컬을 고친 파일은 건너뛰고 `PULL_SKIPPED` |
| `envsync pull --force --json` | 로컬을 고친 파일을 `<파일>.envsync-backup`으로 백업하고 덮어쓰기 (승인 필요). 마지막 동기화 이후 로컬을 고치지 않은 파일은 `--force`여도 백업 없이 fast-forward된다 |
| `envsync push --json` | 올릴 변경(키 이름)만 확인. 쓰지 않고 `CONFIRMATION_REQUIRED`(exit 8)와 `files`를 돌려준다 |
| `envsync push --yes --json` | 올리기 (위 키 이름을 보여주고 승인받은 뒤에만) |
| `envsync push --force --yes --json` | 충돌 검사 없이 덮어쓰기 (명시적 승인 필요) |
| `envsync add <file> --json` / `envsync remove <file> --json` | 관리 파일 추가/제거 (Bitwarden 항목은 삭제하지 않음) |
| `envsync init [--encrypt] [--repo <owner/repo>] --yes --json` | 초기화. 비밀번호가 필요할 수 있으므로 보통 사용자가 직접 실행하도록 안내한다 |

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

## `--json` 출력 스키마

stdout에 JSON 한 줄만 출력된다(사람이 읽는 글은 stderr).

성공:

```json
{
  "ok": true,
  "command": "push",
  "files": [
    { "path": "backend/.env", "status": "pushed", "added": ["NEW_KEY"], "changed": ["API_URL"], "removed": [] }
  ],
  "warnings": ["..."]
}
```

실패:

```json
{
  "ok": false,
  "command": "pull",
  "error": { "code": "PULL_SKIPPED", "message": "...", "hint": "..." },
  "files": [ { "path": "backend/.env", "status": "skipped", "added": [], "changed": ["API_URL"], "removed": [] } ]
}
```

- `files[]`의 필드: `path`(레포 루트 기준, `/` 구분), `status`, 선택적으로 `added`/`changed`/`removed`(키 이름 배열), `opaque`(true이면 키 단위 비교 불가: binary 형식 등, 내용이 바뀌었다는 사실만 알 수 있음), `warning`.
- `status` 값: `synced`, `local-changed`, `remote-changed`, `conflict`, `local-only`, `remote-only`, `missing`, `differs`(기록 없이 내용이 다름), `pushed`, `pulled`, `unchanged`, `skipped`, `local-missing`, `remote-missing`.
- `init`, `add`, `remove`는 `files`가 빈 배열이고 `config`(`init`은 `repo`, `mode`, `files`, `add`/`remove`는 `files`)가 추가된다.
- `error.hint`는 없을 수 있다. 오류 시 `files`는 `CONFLICT`/`PULL_SKIPPED`/`CONFIRMATION_REQUIRED`(push의 올릴 후보)처럼 파일별 요약이 있는 경우에만 채워지고, 그 외에는 빈 배열이다.
- 출력에는 값이 절대 포함되지 않는다. 키 이름과 경로만 있다.
