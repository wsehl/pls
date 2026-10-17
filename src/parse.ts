import { Schema } from "effect";

import { Pid, Port } from "./Listener.ts";

/**
 * Pure parsers for `lsof -F` and `ps` output. Both tools exist on macOS and
 * most Linux distributions, with the same field formats.
 */

export interface Socket {
  readonly pid: Pid;
  readonly name: string;
  readonly user: string;
  readonly address: string;
  readonly port: Port;
}

export interface ProcessInfo {
  readonly pid: Pid;
  readonly ppid: Pid;
  readonly uptimeSeconds: number | null;
  readonly command: string;
}

/** Parses a decimal pid, e.g. from `lsof` output or an environment variable. */
export const parsePid = (text: string | undefined): Pid | null =>
  text !== undefined && /^\d+$/.test(text) ? Pid.make(Number(text)) : null;

/**
 * Parses `lsof -F pcLn` output. Each line is a one-letter field id followed by
 * its value. A `p` line starts a new process; its `c` (command) and `L` (login)
 * apply to every following `n` (socket address) until the next `p`.
 */
export const parseSockets = (output: string): ReadonlyArray<Socket> => {
  const sockets: Array<Socket> = [];
  let current: { pid: Pid; name: string; user: string } | null = null;

  for (const line of output.split("\n")) {
    const field = line[0];
    const value = line.slice(1);
    const pid = field === "p" ? parsePid(value) : null;

    if (pid !== null) {
      current = { pid, name: "", user: "" };
    } else if (current === null) {
      continue;
    } else if (field === "c") {
      current.name = value;
    } else if (field === "L") {
      current.user = value;
    } else if (field === "n") {
      const endpoint = parseEndpoint(value);

      if (endpoint !== null) {
        sockets.push({ ...current, ...endpoint });
      }
    }
  }

  return sockets;
};

/** Splits `127.0.0.1:3000`, `[::1]:3000` or `*:3000` into address and port. */
const parseEndpoint = (
  value: string,
): { address: string; port: Port } | null => {
  const match = /^\[?(.*?)\]?:(\d+)$/.exec(value);

  if (match === null) {
    return null;
  }

  const [, address = "", portText = ""] = match;
  const port = Number(portText);

  return Schema.is(Port)(port) ? { address, port } : null;
};

/** Parses `lsof -a -d cwd -F n` output into a map of pid → working directory. */
export const parseCwds = (output: string): ReadonlyMap<Pid, string> => {
  const cwds = new Map<Pid, string>();
  let pid: Pid | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      pid = parsePid(line.slice(1));
    } else if (line.startsWith("n") && pid !== null) {
      cwds.set(pid, line.slice(1));
    }
  }

  return cwds;
};

/** Parses `ps -A -o pid=,ppid=,etime=,command=` output into a map of pid → process. */
export const parseProcesses = (
  output: string,
): ReadonlyMap<Pid, ProcessInfo> => {
  const processes = new Map<Pid, ProcessInfo>();

  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);

    if (match === null) {
      continue;
    }

    const [, pid = "", ppid = "", elapsed = "", command = ""] = match;

    const info: ProcessInfo = {
      pid: Pid.make(Number(pid)),
      ppid: Pid.make(Number(ppid)),
      uptimeSeconds: parseElapsed(elapsed),
      command,
    };

    processes.set(info.pid, info);
  }

  return processes;
};

/** Parses the `ps` elapsed-time format `[[dd-]hh:]mm:ss` into seconds. */
export const parseElapsed = (elapsed: string): number | null => {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(elapsed);

  if (match === null) {
    return null;
  }

  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  const totalHours = Number(days) * 24 + Number(hours);
  const totalMinutes = totalHours * 60 + Number(minutes);

  return totalMinutes * 60 + Number(seconds);
};

/**
 * Parses `ps eww -o pid=,command=` output, where each process's environment is
 * appended to its command line. Only the requested keys are kept, because
 * environments routinely hold secrets.
 */
export const parseEnvironments = (
  output: string,
  keys: ReadonlyArray<string>,
): ReadonlyMap<Pid, ReadonlyMap<string, string>> => {
  const environments = new Map<Pid, ReadonlyMap<string, string>>();

  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);

    if (match === null) {
      continue;
    }

    const [, pid = "", commandAndEnvironment = ""] = match;
    const environment = new Map<string, string>();

    for (const key of keys) {
      const value = new RegExp(`(?:^|\\s)${key}=(\\S*)`).exec(
        commandAndEnvironment,
      )?.[1];

      if (value !== undefined) {
        environment.set(key, value);
      }
    }

    environments.set(Pid.make(Number(pid)), environment);
  }

  return environments;
};
