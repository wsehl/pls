import { Schema } from "effect";

/** A process id. Branded so a port can never be passed where a pid is expected (e.g. to `kill`). */
export const Pid = Schema.Int.pipe(Schema.brand("Pid"));

export type Pid = typeof Pid.Type;

export const Port = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  Schema.brand("Port"),
);

export type Port = typeof Port.Type;

/** A process somewhere above a listener in the process tree. */
export class Ancestor extends Schema.Class<Ancestor>("pls/Ancestor")({
  pid: Pid,
  name: Schema.String,
  command: Schema.String,
}) {}

export const LauncherKind = Schema.Literals(["agent", "editor", "terminal"]);

export type LauncherKind = typeof LauncherKind.Type;

/** The recognised agent, editor or terminal that (transitively) started a listener. */
export class Launcher extends Schema.Class<Launcher>("pls/Launcher")({
  label: Schema.String,
  kind: LauncherKind,
  /** Unknown when the launcher was identified only by a generic environment marker. */
  pid: Schema.NullOr(Pid),
  /** Agent session or thread id, when the agent exports one (resumable with the agent's CLI). */
  session: Schema.NullOr(Schema.String),
  /** False when the launcher has exited but the listener it started is still running. */
  running: Schema.Boolean,
}) {}

/** One process listening on one TCP port, possibly bound to several addresses. */
export class Listener extends Schema.Class<Listener>("pls/Listener")({
  port: Port,
  addresses: Schema.Array(Schema.String),
  pid: Pid,
  /** Executable name as reported by the OS, e.g. `node`. */
  name: Schema.String,
  /** What is actually serving, e.g. `vite` for `node …/vite.js`. */
  label: Schema.String,
  user: Schema.String,
  command: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  uptimeSeconds: Schema.NullOr(Schema.Int),
  launcher: Schema.NullOr(Launcher),
  /** Parent first, ending just below PID 1. */
  ancestry: Schema.Array(Ancestor),
}) {}
