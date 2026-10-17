import { Context, Effect, Layer, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { assemble } from "./assemble.ts";
import type { Listener, Pid } from "./Listener.ts";
import { parseSockets } from "./parse.ts";

export type Signal = "TERM" | "KILL";

export class ScanError extends Schema.TaggedError<ScanError>()("ScanError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Every listening TCP socket as pid (p), command name (c), login (L) and address (n). `+c 0` disables name truncation. */
const listSockets = ChildProcess.make("lsof", [
  "-nP",
  "+c",
  "0",
  "-iTCP",
  "-sTCP:LISTEN",
  "-F",
  "pcLn",
]);

/** The whole process table, so the parent chain of each listener can be walked. */
const listProcesses = ChildProcess.make("ps", [
  "-A",
  "-o",
  "pid=,ppid=,etime=,command=",
]);

const listCwds = (pids: ReadonlyArray<Pid>) =>
  ChildProcess.make("lsof", [
    "-a",
    "-d",
    "cwd",
    "-p",
    pids.join(","),
    "-F",
    "n",
  ]);

/** BSD-style `e` appends each process's environment to its command line, on both macOS and Linux procps. */
const listEnvironments = (pids: ReadonlyArray<Pid>) =>
  ChildProcess.make("ps", ["eww", "-o", "pid=,command=", "-p", pids.join(",")]);

/** Discovers TCP listeners by running `lsof` and `ps`, and stops them with `kill`. */
export class PortScanner extends Context.Service<
  PortScanner,
  {
    readonly listeners: Effect.Effect<ReadonlyArray<Listener>, ScanError>;
    readonly kill: (pid: Pid, signal: Signal) => Effect.Effect<void, ScanError>;
  }
>()("pls/PortScanner") {
  static readonly layer = Layer.effect(
    PortScanner,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      // `string` ignores the exit code, which is what we want: lsof exits 1 when nothing matches.
      const output = (command: ChildProcess.StandardCommand) =>
        spawner.string(command).pipe(
          Effect.mapError(
            (cause) =>
              new ScanError({
                message: `Failed to run \`${command.command}\``,
                cause,
              }),
          ),
        );

      const listeners = Effect.gen(function* () {
        const [sockets, processes] = yield* Effect.all(
          [output(listSockets), output(listProcesses)],
          {
            concurrency: "unbounded",
          },
        );

        const pids = [
          ...new Set(parseSockets(sockets).map((socket) => socket.pid)),
        ];

        if (pids.length === 0) {
          return [];
        }

        const [cwds, environments] = yield* Effect.all(
          [output(listCwds(pids)), output(listEnvironments(pids))],
          {
            concurrency: "unbounded",
          },
        );

        return assemble({ sockets, processes, cwds, environments });
      }).pipe(Effect.withSpan("PortScanner.listeners"));

      const kill = Effect.fn("PortScanner.kill")(function* (
        pid: Pid,
        signal: Signal,
      ) {
        const exitCode = yield* spawner
          .exitCode(ChildProcess.make("kill", ["-s", signal, String(pid)]))
          .pipe(
            Effect.mapError(
              (cause) =>
                new ScanError({ message: "Failed to run `kill`", cause }),
            ),
          );

        if (exitCode !== 0) {
          return yield* new ScanError({
            message: `Could not signal pid ${pid}: it may belong to another user or have already exited`,
            cause: null,
          });
        }
      });

      return PortScanner.of({ listeners, kill });
    }),
  );
}
