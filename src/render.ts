import type { Launcher, LauncherKind, Listener, Port } from "./Listener.ts";

export interface RenderOptions {
  readonly color: boolean;
  /** Terminal width, used to truncate the directory column; `Infinity` disables truncation. */
  readonly width: number;
  /** Replaced with `~` in displayed paths; empty to disable. */
  readonly home: string;
}

const ansiCodes = {
  bold: "1",
  dim: "2",
  green: "32",
  yellow: "33",
  blue: "34",
  magenta: "35",
} as const;

type Style = keyof typeof ansiCodes;

type Paint = (style: Style, text: string) => string;

const makePaint =
  (color: boolean): Paint =>
  (style, text) =>
    color ? `\x1b[${ansiCodes[style]}m${text}\x1b[0m` : text;

const launcherStyles: Record<LauncherKind, Style> = {
  agent: "magenta",
  editor: "blue",
  terminal: "dim",
};

const missing = "—";

/** Bind addresses meaning "every interface", i.e. reachable from outside this machine. */
const wildcardAddresses = new Set(["*", "0.0.0.0", "::"]);

export const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
};

const formatUptime = (seconds: number | null): string =>
  seconds === null ? missing : formatDuration(seconds);

const tildify = (text: string, home: string): string =>
  home === "" ? text : text.replaceAll(home, "~");

/** Keeps the end of a path, which is the part that identifies the project. */
const truncateStart = (text: string, maxLength: number): string =>
  text.length <= maxLength
    ? text
    : `…${text.slice(text.length - maxLength + 1)}`;

// ─── Table ──────────────────────────────────────────────────────────────────

interface Cell {
  readonly text: string;
  readonly style?: Style;
}

const headers = ["PORT", "PID", "PROCESS", "VIA", "UP", "DIRECTORY"];

const columnGap = "  ";

/** The directory column never shrinks below this, even if the row then wraps. */
const minDirectoryWidth = 12;

const launcherCell = (launcher: Launcher | null): Cell => {
  if (launcher === null) {
    return { text: missing, style: "dim" };
  }

  // The server itself is alive; it is the agent session that started it which is gone.
  if (!launcher.running) {
    return { text: `${launcher.label} (session ended)`, style: "yellow" };
  }

  return { text: launcher.label, style: launcherStyles[launcher.kind] };
};

const rowCells = (listener: Listener, home: string): ReadonlyArray<Cell> => [
  { text: String(listener.port), style: "bold" },
  { text: String(listener.pid), style: "dim" },
  { text: listener.label, style: "green" },
  launcherCell(listener.launcher),
  { text: formatUptime(listener.uptimeSeconds) },
  listener.cwd === null
    ? { text: missing, style: "dim" }
    : { text: tildify(listener.cwd, home) },
];

/** Pads every column to its widest cell, except the last (directory), which gets the remaining width. */
const formatRows = (
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  width: number,
  paint: Paint,
): Array<string> => {
  const columnWidths = headers.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.text.length ?? 0)),
  );
  const fixedWidth = columnWidths
    .slice(0, -1)
    .reduce((sum, columnWidth) => sum + columnWidth + columnGap.length, 0);
  const directoryWidth = Math.max(width - fixedWidth, minDirectoryWidth);

  return rows.map((row) =>
    row
      .map((cell, column) => {
        const isLast = column === row.length - 1;
        const text = isLast
          ? truncateStart(cell.text, directoryWidth)
          : cell.text.padEnd(columnWidths[column] ?? 0);

        return cell.style === undefined ? text : paint(cell.style, text);
      })
      .join(columnGap),
  );
};

/** Notes printed under the table, so nothing is hidden or left running silently. */
const footerLines = (
  listeners: ReadonlyArray<Listener>,
  hiddenCount: number,
  paint: Paint,
): Array<string> => {
  const lines: Array<string> = [];
  const orphanedPorts = new Set<Port>();

  for (const listener of listeners) {
    if (listener.launcher?.running === false) {
      orphanedPorts.add(listener.port);
    }
  }

  if (orphanedPorts.size > 0) {
    const pronoun = orphanedPorts.size === 1 ? "it" : "them";
    const killCommand = `pls kill ${[...orphanedPorts].join(" ")}`;

    lines.push(
      paint(
        "yellow",
        `${orphanedPorts.size} still running after the agent session that started ${pronoun} ended. Stop with: ${killCommand}`,
      ),
    );
  }

  if (hiddenCount > 0) {
    const plural = hiddenCount === 1 ? "" : "s";

    lines.push(
      paint(
        "dim",
        `${hiddenCount} system/app listener${plural} hidden, use --all to show`,
      ),
    );
  }

  return lines;
};

export const renderTable = (
  {
    listeners,
    hiddenCount,
  }: {
    readonly listeners: ReadonlyArray<Listener>;
    readonly hiddenCount: number;
  },
  options: RenderOptions,
): string => {
  const paint = makePaint(options.color);
  const footer = footerLines(listeners, hiddenCount, paint);

  if (listeners.length === 0) {
    return [
      paint("dim", "Nothing is listening on any TCP port."),
      ...footer,
    ].join("\n");
  }

  const headerRow = headers.map((text): Cell => ({ text, style: "dim" }));
  const rows = [
    headerRow,
    ...listeners.map((listener) => rowCells(listener, options.home)),
  ];

  return [...formatRows(rows, options.width, paint), ...footer].join("\n");
};

// ─── Detail ─────────────────────────────────────────────────────────────────

const describeAddresses = (
  addresses: ReadonlyArray<string>,
  paint: Paint,
): string => {
  const list = addresses.join(", ");
  const exposed = addresses.some((address) => wildcardAddresses.has(address));

  return exposed
    ? `${list}  ${paint("yellow", "reachable from network")}`
    : list;
};

const describeLauncher = (launcher: Launcher | null, paint: Paint): string => {
  if (launcher === null) {
    return missing;
  }

  const parts = [paint(launcherStyles[launcher.kind], launcher.label)];

  if (launcher.pid !== null) {
    parts.push(paint("dim", `(pid ${launcher.pid})`));
  }

  if (launcher.session !== null) {
    parts.push(paint("dim", `session ${launcher.session}`));
  }

  if (!launcher.running) {
    parts.push(paint("yellow", "· session ended, server still running"));
  }

  return parts.join(" ");
};

/** The listener followed by its ancestors, e.g. `vite 64589 ← pnpm 64564 ← zsh 259`. */
const describeTree = (listener: Listener, paint: Paint): string => {
  const processes = [
    { name: listener.label, pid: listener.pid },
    ...listener.ancestry,
  ];

  return processes
    .map(({ name, pid }) => `${name} ${paint("dim", String(pid))}`)
    .join(paint("dim", " ← "));
};

export const renderDetail = (
  listener: Listener,
  options: RenderOptions,
): string => {
  const paint = makePaint(options.color);
  const field = (name: string, value: string) =>
    `  ${paint("dim", name.padEnd(8))} ${value}`;

  const title = [
    paint("bold", `:${listener.port}`),
    paint("green", listener.label),
    paint("dim", `pid ${listener.pid} · ${listener.user}`),
  ].join("  ");

  return [
    title,
    field("bound", describeAddresses(listener.addresses, paint)),
    field(
      "dir",
      listener.cwd === null ? missing : tildify(listener.cwd, options.home),
    ),
    field("up", formatUptime(listener.uptimeSeconds)),
    field("via", describeLauncher(listener.launcher, paint)),
    field("command", tildify(listener.command, options.home)),
    field("tree", describeTree(listener, paint)),
  ].join("\n");
};
