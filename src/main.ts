#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Config,
  Console,
  Effect,
  Layer,
  Option,
  Stdio,
  Terminal,
} from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";

import packageJson from "../package.json" with { type: "json" };
import { type Listener, Port } from "./Listener.ts";
import { PortScanner, type ScanError } from "./PortScanner.ts";
import { type RenderOptions, renderDetail, renderTable } from "./render.ts";

const toUserError = (error: ScanError) =>
  new CliError.UserError({ cause: error, userMessage: error.message });

const scanListeners = PortScanner.use((scanner) => scanner.listeners).pipe(
  Effect.mapError(toUserError),
);

const nothingListening = (ports: ReadonlyArray<Port>) =>
  new CliError.UserError({
    cause: null,
    userMessage: `Nothing is listening on ${ports.map((port) => `:${port}`).join(", ")}`,
  });

/** Colour and truncation only make sense on an interactive terminal. Honours https://no-color.org. */
const renderOptions = Effect.gen(function* () {
  const isTerminal = yield* Stdio.Stdio.use((stdio) => stdio.stdoutIsTerminal);
  const noColor = yield* Config.String("NO_COLOR").pipe(Config.option);
  const home = yield* Config.String("HOME").pipe(Config.withDefault(""));
  const width = isTerminal
    ? yield* Terminal.Terminal.use((terminal) => terminal.columns)
    : Infinity;

  return {
    color: isTerminal && Option.isNone(noColor),
    width,
    home,
  } satisfies RenderOptions;
});

/**
 * GUI apps and system daemons are started by launchd/init with `/` as their
 * working directory, whereas dev servers run inside a project.
 */
const isSystemListener = (listener: Listener) => listener.cwd === "/";

const selectListeners = (
  listeners: ReadonlyArray<Listener>,
  {
    ports,
    includeSystem,
  }: { readonly ports: ReadonlyArray<Port>; readonly includeSystem: boolean },
): ReadonlyArray<Listener> => {
  // Explicitly requested ports are never hidden.
  if (ports.length > 0) {
    return listeners.filter((listener) => ports.includes(listener.port));
  }

  if (includeSystem) {
    return listeners;
  }

  return listeners.filter((listener) => !isSystemListener(listener));
};

const portsArgument = (description: string) =>
  Argument.Int("port").pipe(
    Argument.withSchema(Port),
    Argument.withDescription(description),
  );

const pls = Command.make(
  "pls",
  {
    ports: portsArgument("Only show these ports, with full details").pipe(
      Argument.variadic(),
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withAlias("a"),
      Flag.withDescription(
        "Include system services and GUI apps (those running from `/`)",
      ),
      Flag.withDefault(false),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print machine-readable JSON"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* ({ all, json, ports }) {
    const listeners = yield* scanListeners;
    const selected = selectListeners(listeners, { ports, includeSystem: all });

    if (json) {
      return yield* Console.log(JSON.stringify(selected, null, 2));
    }

    if (ports.length > 0 && selected.length === 0) {
      return yield* nothingListening(ports);
    }

    const options = yield* renderOptions;

    if (ports.length > 0) {
      return yield* Console.log(
        selected
          .map((listener) => renderDetail(listener, options))
          .join("\n\n"),
      );
    }

    const hiddenCount = listeners.length - selected.length;

    yield* Console.log(
      renderTable({ listeners: selected, hiddenCount }, options),
    );
  }),
).pipe(
  Command.withDescription(
    "See which processes are listening on which TCP ports, where they run and what started them",
  ),
  Command.withExamples([
    {
      command: "pls",
      description: "List listening ports, hiding system services",
    },
    { command: "pls --all", description: "List every listening port" },
    {
      command: "pls 3000 5173",
      description: "Show details for specific ports",
    },
    { command: "pls --json", description: "Print listeners as JSON" },
  ]),
);

const kill = Command.make(
  "kill",
  {
    ports: portsArgument(
      "Port(s) whose listening processes should be stopped",
    ).pipe(Argument.variadic({ min: 1 })),
    force: Flag.Boolean("force").pipe(
      Flag.withAlias("f"),
      Flag.withDescription("Send SIGKILL instead of SIGTERM"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* ({ force, ports }) {
    const scanner = yield* PortScanner;
    const listeners = yield* scanListeners;
    const requested = listeners.filter((listener) =>
      ports.includes(listener.port),
    );

    // One process can listen on several of the requested ports; signal it only once.
    const targets = new Map(
      requested.map((listener) => [listener.pid, listener]),
    )
      .values()
      .toArray();

    if (targets.length === 0) {
      return yield* nothingListening(ports);
    }

    const signal = force ? "KILL" : "TERM";

    for (const target of targets) {
      yield* scanner
        .kill(target.pid, signal)
        .pipe(Effect.mapError(toUserError));
      yield* Console.log(
        `Sent SIG${signal} to ${target.label} (pid ${target.pid}) on :${target.port}`,
      );
    }
  }),
).pipe(
  Command.withDescription("Stop whatever is listening on the given port(s)"),
  Command.withExamples([
    {
      command: "pls kill 3000",
      description: "Gracefully stop the server on :3000",
    },
    {
      command: "pls kill -f 3000 3001",
      description: "Force-kill servers on :3000 and :3001",
    },
  ]),
);

pls.pipe(
  Command.withSubcommands([kill]),
  Command.run({ version: packageJson.version }),
  Effect.provide(
    PortScanner.layer.pipe(Layer.provideMerge(NodeServices.layer)),
  ),
  NodeRuntime.runMain,
);
