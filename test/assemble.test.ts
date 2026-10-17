import { assert, describe, it } from "@effect/vitest";

import { assemble } from "../src/assemble.ts";
import { Port } from "../src/Listener.ts";

const lines = (...values: ReadonlyArray<string>) => values.join("\n");

describe("assemble", () => {
  const snapshot = {
    sockets: lines(
      "p300",
      "cnode",
      "Lme",
      "f20",
      "n127.0.0.1:5173",
      "f21",
      "n[::1]:5173",
      "f22",
      "n*:24678",
    ),
    processes: lines(
      "  100     1 02-01:00:00 claude --model opus",
      "  200   100       10:00 /bin/zsh -c pnpm dev",
      "  300   200       09:59 node /w/app/node_modules/.bin/vite --port 5173",
      "  400     1       01:00 node /w/old/node_modules/.bin/next dev",
    ),
    cwds: lines("p300", "fcwd", "n/w/app", "p400", "fcwd", "n/w/old"),
    environments: "",
  };

  /** A detached `next` server on :3000 whose environment names a Claude Code session. */
  const detached = (environment: string) =>
    assemble({
      ...snapshot,
      sockets: lines("p400", "cnode", "Lme", "f20", "n*:3000"),
      environments: environment,
    });

  it("merges the IPv4 and IPv6 sockets of one process into a single listener per port", () => {
    const listeners = assemble(snapshot);

    assert.deepStrictEqual(
      listeners.map((listener) => [listener.port, listener.addresses]),
      [
        [Port.make(5173), ["127.0.0.1", "::1"]],
        [Port.make(24678), ["*"]],
      ],
    );
  });

  it("joins process info, working directory and the launching agent", () => {
    const [vite] = assemble(snapshot);

    assert.strictEqual(vite?.label, "vite");
    assert.strictEqual(vite?.cwd, "/w/app");
    assert.strictEqual(vite?.uptimeSeconds, 599);
    assert.deepStrictEqual(
      vite?.ancestry.map((ancestor) => ancestor.pid),
      [200, 100],
    );
    assert.strictEqual(vite?.launcher?.label, "Claude Code");
    assert.isTrue(vite?.launcher?.running);
  });

  it("flags listeners whose agent has exited", () => {
    // pid 999 is not in the process table.
    const [orphan] = detached(
      "  400 node next dev CLAUDECODE=1 CLAUDE_PID=999",
    );

    assert.strictEqual(orphan?.label, "next");
    assert.deepStrictEqual(orphan?.ancestry, []);
    assert.strictEqual(orphan?.launcher?.label, "Claude Code");
    assert.isFalse(orphan?.launcher?.running);
  });

  it("treats a reused agent pid as exited", () => {
    // pid 200 exists, but it is a shell, not Claude Code.
    const [orphan] = detached(
      "  400 node next dev CLAUDECODE=1 CLAUDE_PID=200",
    );

    assert.isFalse(orphan?.launcher?.running);
  });
});
