# pls

See what's listening on your ports, where it runs, and **which agent started it**.

```
$ pls
PORT  PID    PROCESS  VIA                          UP      DIRECTORY
3000  26235  tsx      Claude Code (session ended)  1d 2h   ~/Code/acme/apps/server
4206  64589  vite     Ghostty                      2h 30m  ~/Code/uptime-zero
5173  41022  next     Codex                        12m     ~/Code/shop
1 still running after the agent session that started it ended. Stop with: pls kill 3000
12 system/app listeners hidden, use --all to show

$ pls 3000
:3000  tsx  pid 26235 · me
  bound    *  reachable from network
  dir      ~/Code/acme/apps/server
  up       1d 2h
  via      Claude Code (pid 88521) session 66cbf1ad-… · session ended, server still running
  command  node --require …/tsx/dist/preflight.cjs src/api/main.ts
  tree     tsx 26235 ← tsx 39439 ← pnpm 39362

$ pls kill 3000        # SIGTERM; -f for SIGKILL
```

## Install

```sh
pnpm install -g @wsehl/pls
```

## Usage

| Command                   |                                                                              |
| ------------------------- | ---------------------------------------------------------------------------- |
| `pls`                     | Listening TCP ports, hiding GUI apps/system daemons (those running from `/`) |
| `pls --all`               | Everything                                                                   |
| `pls <port...>`           | Full details for specific ports                                              |
| `pls --json`              | Machine-readable output                                                      |
| `pls kill [-f] <port...>` | Stop whatever listens on those ports                                         |
| `pls --completions zsh`   | Shell completions                                                            |

## How it works

No native dependencies: it shells out to `lsof` and `ps` (macOS and Linux).

- **Sockets**: `lsof -iTCP -sTCP:LISTEN`, merged per process and port across IPv4/IPv6.
- **What it is**: interpreters are resolved to the tool they run (`node …/vite.js` → `vite`).
- **Where**: the process's working directory (`lsof -d cwd`).
- **Who started it**: first the process tree is walked up to the nearest known agent, editor or terminal. If the server was detached (re-parented to PID 1), agent markers inherited through its environment are used instead: `CLAUDECODE`/`CLAUDE_PID`/`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `GEMINI_CLI`, `CURSOR_AGENT`, or the generic `AI_AGENT`. Only those keys are ever read. If the agent session has ended but the server is still running, it is flagged and the footer suggests the `pls kill` command.
