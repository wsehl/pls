import {
  detectLauncher,
  environmentKeys,
  isLauncherProcess,
  labelFor,
  shortName,
} from "./identify.ts";
import { Ancestor, Launcher, Listener, type Pid } from "./Listener.ts";
import {
  type ProcessInfo,
  type Socket,
  parseCwds,
  parseEnvironments,
  parseProcesses,
  parseSockets,
} from "./parse.ts";

/** Raw output of the discovery commands, kept apart from running them so assembly is pure and testable. */
export interface Snapshot {
  readonly sockets: string;
  readonly processes: string;
  readonly cwds: string;
  readonly environments: string;
}

interface ParsedSnapshot {
  readonly processes: ReadonlyMap<Pid, ProcessInfo>;
  readonly cwds: ReadonlyMap<Pid, string>;
  readonly environments: ReadonlyMap<Pid, ReadonlyMap<string, string>>;
}

/** Joins sockets, the process table, working directories and environments into listeners. */
export const assemble = (snapshot: Snapshot): ReadonlyArray<Listener> => {
  const parsed: ParsedSnapshot = {
    processes: parseProcesses(snapshot.processes),
    cwds: parseCwds(snapshot.cwds),
    environments: parseEnvironments(snapshot.environments, environmentKeys),
  };

  return groupSockets(parseSockets(snapshot.sockets))
    .map((group) => toListener(group, parsed))
    .toSorted((a, b) => a.port - b.port || a.pid - b.pid);
};

interface SocketGroup {
  readonly socket: Socket;
  readonly addresses: Array<string>;
}

/** One group per (pid, port): servers usually bind IPv4 and IPv6 separately, and lsof lists each. */
const groupSockets = (
  sockets: ReadonlyArray<Socket>,
): ReadonlyArray<SocketGroup> => {
  const groups = new Map<string, SocketGroup>();

  for (const socket of sockets) {
    const key = `${socket.pid}:${socket.port}`;
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, { socket, addresses: [socket.address] });
    } else if (!group.addresses.includes(socket.address)) {
      group.addresses.push(socket.address);
    }
  }

  return [...groups.values()];
};

const toListener = (
  { socket, addresses }: SocketGroup,
  parsed: ParsedSnapshot,
): Listener => {
  const info = parsed.processes.get(socket.pid);
  const command = info?.command ?? socket.name;
  const ancestry = ancestorsOf(socket.pid, parsed.processes);
  const environment =
    parsed.environments.get(socket.pid) ?? new Map<string, string>();
  const launcher = detectLauncher(ancestry, environment);

  return new Listener({
    port: socket.port,
    addresses,
    pid: socket.pid,
    name: socket.name,
    label: labelFor(socket.name, command),
    user: socket.user,
    command,
    cwd: parsed.cwds.get(socket.pid) ?? null,
    uptimeSeconds: info?.uptimeSeconds ?? null,
    launcher:
      launcher === null ? null : withLiveness(launcher, parsed.processes),
    ancestry,
  });
};

/** An agent named by an environment marker may have exited since, and its pid may have been reused. */
const withLiveness = (
  launcher: Launcher,
  processes: ReadonlyMap<Pid, ProcessInfo>,
): Launcher => {
  if (launcher.pid === null) {
    return launcher;
  }

  const launcherProcess = processes.get(launcher.pid);
  const alive =
    launcherProcess !== undefined &&
    isLauncherProcess(launcher.label, launcherProcess.command);

  return alive ? launcher : new Launcher({ ...launcher, running: false });
};

/** Walks parent links up to, but excluding, PID 1. Tracks visited pids in case pid reuse forms a cycle. */
const ancestorsOf = (
  pid: Pid,
  processes: ReadonlyMap<Pid, ProcessInfo>,
): ReadonlyArray<Ancestor> => {
  const ancestry: Array<Ancestor> = [];
  const visited = new Set([pid]);
  const ppid = processes.get(pid)?.ppid;
  let parent = ppid === undefined ? undefined : processes.get(ppid);

  while (parent !== undefined && parent.pid > 1 && !visited.has(parent.pid)) {
    visited.add(parent.pid);
    ancestry.push(
      new Ancestor({
        pid: parent.pid,
        name: labelFor(shortName(parent.command), parent.command),
        command: parent.command,
      }),
    );
    parent = processes.get(parent.ppid);
  }

  return ancestry;
};
