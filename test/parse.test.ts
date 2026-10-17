import { assert, describe, it } from "@effect/vitest";

import { Pid, Port } from "../src/Listener.ts";
import { parseElapsed, parseEnvironments, parseSockets } from "../src/parse.ts";

describe("parseSockets", () => {
  it("attributes every socket to the preceding process and unwraps IPv6 brackets", () => {
    const output = [
      "p664",
      "credis-server",
      "Lwsehl",
      "f6",
      "n127.0.0.1:6379",
      "f7",
      "n[::1]:6379",
      "p70",
      "cnode",
      "Lroot",
      "f3",
      "n*:3000",
      "",
    ].join("\n");

    assert.deepStrictEqual(parseSockets(output), [
      {
        pid: Pid.make(664),
        name: "redis-server",
        user: "wsehl",
        address: "127.0.0.1",
        port: Port.make(6379),
      },
      {
        pid: Pid.make(664),
        name: "redis-server",
        user: "wsehl",
        address: "::1",
        port: Port.make(6379),
      },
      {
        pid: Pid.make(70),
        name: "node",
        user: "root",
        address: "*",
        port: Port.make(3000),
      },
    ]);
  });
});

describe("parseElapsed", () => {
  it.each([
    ["00:03", 3],
    ["21:01", 21 * 60 + 1],
    ["04:56:28", 4 * 3600 + 56 * 60 + 28],
    ["02-07:08:53", 2 * 86400 + 7 * 3600 + 8 * 60 + 53],
  ] as const)("%s → %i seconds", (etime, seconds) => {
    assert.strictEqual(parseElapsed(etime), seconds);
  });

  it("returns null for unknown formats", () => {
    assert.isNull(parseElapsed("yesterday"));
  });
});

describe("parseEnvironments", () => {
  it("keeps only whitelisted variables", () => {
    const output =
      "  4242 node server.js CLAUDECODE=1 GITHUB_TOKEN=secret CLAUDE_PID=88521\n";
    const env = parseEnvironments(output, ["CLAUDECODE", "CLAUDE_PID"]).get(
      Pid.make(4242),
    );
    assert.deepStrictEqual(env && Object.fromEntries(env), {
      CLAUDECODE: "1",
      CLAUDE_PID: "88521",
    });
  });
});
