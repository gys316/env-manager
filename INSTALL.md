# envsync 설치 가이드 (AI 에이전트용)

이 문서는 AI 코딩 에이전트(Claude Code 등)가 사용자 대신 envsync를 설치할 때 따르는 절차입니다. 사람이 직접 설치한다면 [README의 설치](README.md#설치)를 보세요.

사용자는 에이전트에게 이렇게 요청하면 됩니다.

> `https://github.com/<owner>/env-manager/blob/main/INSTALL.md` 를 읽고 envsync를 설치해줘.

## 에이전트가 지켜야 할 규칙

- **Bitwarden 로그인과 잠금 해제는 하지 않는다.** `bw login`, `bw unlock`을 실행하지 말고, 마스터 비밀번호·2FA 코드·세션 토큰을 묻거나 받지 않는다. 이 단계는 마지막에 사용자에게 안내만 한다.
- 시스템에 프로그램을 설치하기 전에(winget/brew/npm -g) 무엇을 설치할지 한 번에 보여 주고 사용자 승인을 받는다.
- 이미 설치된 것은 건너뛴다. 각 단계는 먼저 확인 명령을 실행한다.
- 설치 직후 명령을 찾지 못하면(Windows에서 winget 설치 후 흔함) PATH가 현재 셸에 반영되지 않은 것이다. 새 터미널이 필요하다고 사용자에게 알리고, 확인은 설치 경로로 직접 하거나 다음 세션으로 넘긴다.

## 1. 확인

| 확인 | 명령 | 통과 조건 |
|---|---|---|
| Node.js | `node --version` | 22.12 이상 |
| git | `git --version` | 있음 |
| Bitwarden CLI | `bw --version` | 있음 |
| sops (SOPS 모드를 쓸 때만) | `sops --version --disable-version-check` | 3.9 이상 |
| envsync | `envsync --version` | 있음 |
| 스킬 | `~/.claude/skills/envsync/SKILL.md` 존재 | 있음 |

Node.js가 22.12 미만이면 설치를 멈추고 사용자에게 Node 업그레이드를 요청한다(nvm 등 사용자 환경에 따라 다르므로 에이전트가 임의로 바꾸지 않는다).

SOPS 모드(암호화 파일을 git에 커밋하는 방식)를 쓸지 모르면 사용자에게 묻는다. 기본은 Bitwarden에만 저장하는 vault 모드이며 sops가 필요 없다.

## 2. 설치

필요한 것만 설치한다.

**Bitwarden CLI**

| OS | 명령 |
|---|---|
| Windows | `winget install --id Bitwarden.CLI -e --accept-source-agreements --accept-package-agreements` |
| macOS | `brew install bitwarden-cli` |
| Linux / 공통 | `npm i -g @bitwarden/cli` |

**sops (SOPS 모드를 쓸 때만)**

| OS | 명령 |
|---|---|
| Windows | `winget install --id SecretsOPerationS.SOPS -e --accept-source-agreements --accept-package-agreements` |
| macOS | `brew install sops` |
| Linux | https://github.com/getsops/sops/releases 에서 플랫폼 바이너리를 받아 체크섬(`sops-v<버전>.checksums.txt`)을 확인한 뒤 PATH에 둔다 |

**envsync CLI**

```
npm i -g github:<owner>/env-manager
```

레포를 이미 클론했다면 그 폴더에서 `npm install && npm run build && npm link`로 대신한다.

**Claude Code 스킬**

```
npx skills add <owner>/env-manager --skill envsync -a claude-code -g -y
```

클론한 폴더가 있다면 `<owner>/env-manager` 대신 그 경로를 넣어도 된다(예: `npx skills add ./env-manager --skill envsync -a claude-code -g -y`). 스킬은 다음 Claude Code 세션부터 불러온다.

## 3. 검증

1단계 확인 표를 다시 실행해 모두 통과하는지 본다. 결과를 표로 사용자에게 보고한다.

## 4. 사용자에게 넘길 안내 (그대로 전달)

설치가 끝나면 아래를 사용자에게 안내하고 멈춘다. 에이전트는 이 명령들을 실행하지 않는다.

```
# 1) Bitwarden 로그인 (처음 한 번)
bw login

# 2) 잠금 해제 후 같은 터미널에서 Claude Code 실행
#    PowerShell
$env:BW_SESSION = (bw unlock --raw)
#    bash / zsh
export BW_SESSION=$(bw unlock --raw)

claude
```

그다음 레포에서 "envsync로 env 설정해줘"(처음) 또는 "envsync로 env 받아줘"(새 PC)라고 요청하면 envsync 스킬이 이어서 처리한다.
