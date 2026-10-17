import { assert, describe, it } from "@effect/vitest";

import { detectLauncher, labelFor, shortName } from "../src/identify.ts";
import { Pid } from "../src/Listener.ts";

const ancestor = (pid: number, command: string) => ({
  pid: Pid.make(pid),
  command,
});

describe("labelFor", () => {
  it.each([
    ["node", "node /p/node_modules/.bin/next dev", "next"],
    // pnpm shims resolve through `.bin/../.pnpm/…`; the real package is the last node_modules segment.
    [
      "node",
      "node /p/node_modules/.bin/../.pnpm/vite@8.0.16/node_modules/vite/bin/vite.js dev",
      "vite",
    ],
    [
      "node",
      "node --require /p/node_modules/.pnpm/tsx@4/node_modules/tsx/dist/preflight.cjs src/main.ts",
      "tsx",
    ],
    ["python3.11", "/usr/bin/python3 -m http.server 4999", "http.server"],
    ["node", "node server.js", "server.js"],
    [
      "redis-server",
      "/opt/homebrew/bin/redis-server 127.0.0.1:6379",
      "redis-server",
    ],
  ] as const)("%s %s → %s", (name, command, label) => {
    assert.strictEqual(labelFor(name, command), label);
  });
});

describe("shortName", () => {
  it("uses the outermost app bundle name, which may contain spaces", () => {
    assert.strictEqual(
      shortName(
        "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper",
      ),
      "Visual Studio Code",
    );
  });

  it("strips login-shell dashes", () => {
    assert.strictEqual(shortName("-zsh"), "zsh");
  });
});

describe("detectLauncher", () => {
  const noEnv = new Map<string, string>();

  const claudeEnv = new Map([
    ["CLAUDECODE", "1"],
    ["CLAUDE_PID", "88521"],
    ["CLAUDE_CODE_SESSION_ID", "abc-123"],
  ]);

  const tree = [
    ancestor(30, "pnpm dev"),
    ancestor(20, "claude --model opus"),
    ancestor(10, "/Applications/Ghostty.app/Contents/MacOS/ghostty"),
  ];

  it("prefers the nearest agent in the process tree", () => {
    const launcher = detectLauncher(tree, noEnv);

    assert.strictEqual(launcher?.label, "Claude Code");
    assert.strictEqual(launcher?.pid, 20);
  });

  it("attaches the session id from the environment to a tree-detected agent", () => {
    assert.strictEqual(detectLauncher(tree, claudeEnv)?.session, "abc-123");
  });

  it("identifies the agent from the environment once the server is detached", () => {
    const launcher = detectLauncher([], claudeEnv);

    assert.deepStrictEqual(
      launcher && {
        label: launcher.label,
        pid: launcher.pid,
        session: launcher.session,
      },
      {
        label: "Claude Code",
        pid: Pid.make(88521),
        session: "abc-123",
      },
    );
  });

  it("lets an environment agent outrank a terminal ancestor", () => {
    const launcher = detectLauncher(
      [ancestor(10, "tmux new -s dev")],
      new Map([["CODEX_THREAD_ID", "t-1"]]),
    );

    assert.strictEqual(launcher?.label, "Codex");
    assert.strictEqual(launcher?.session, "t-1");
  });

  it("falls back to the generic AI_AGENT marker", () => {
    assert.strictEqual(
      detectLauncher([], new Map([["AI_AGENT", "pi"]]))?.label,
      "pi",
    );
  });

  it("does not mistake paths containing agent names for agents", () => {
    assert.isNull(
      detectLauncher(
        [ancestor(5, "node /home/me/claude-experiments/server.js")],
        noEnv,
      ),
    );
  });
});
