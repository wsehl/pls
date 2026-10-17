import { type Ancestor, Launcher, type LauncherKind } from "./Listener.ts";
import { parsePid } from "./parse.ts";

/**
 * Heuristics that turn raw process data into something a human recognises:
 * what a process is, and which agent, editor or terminal started it.
 */

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** `name` as the executable itself (`name …` or `/path/to/name …`), not inside some other path. */
const executable = (name: string): RegExp =>
  new RegExp(`(^|/)${escapeRegExp(name)}(\\s|:|$)`);

/** A macOS app bundle; also matches variants such as "Zed Preview" or "T3 Code (Nightly)". */
const app = (name: string): RegExp =>
  new RegExp(`/${escapeRegExp(name)}[^/]*\\.app/`);

/** A script run from an installed npm package. */
const npmPackage = (name: string): RegExp =>
  new RegExp(`node_modules/${escapeRegExp(name)}/`);

/** `python -m name`. */
const pythonModule = (name: string): RegExp =>
  new RegExp(`\\s-m\\s+${escapeRegExp(name)}(\\s|$)`);

interface KnownLauncher {
  readonly label: string;
  readonly kind: LauncherKind;
  readonly matchers: ReadonlyArray<RegExp>;
}

/** Matched against each ancestor's full command line, nearest ancestor first. */
const knownLaunchers: ReadonlyArray<KnownLauncher> = [
  // Agents
  {
    label: "Claude Code",
    kind: "agent",
    matchers: [executable("claude"), npmPackage("@anthropic-ai/claude-code")],
  },
  { label: "Claude", kind: "agent", matchers: [app("Claude")] },
  {
    label: "Codex",
    kind: "agent",
    matchers: [executable("codex"), npmPackage("@openai/codex"), app("Codex")],
  },
  {
    label: "Gemini CLI",
    kind: "agent",
    matchers: [executable("gemini"), npmPackage("@google/gemini-cli")],
  },
  {
    label: "Copilot CLI",
    kind: "agent",
    matchers: [executable("copilot"), npmPackage("@github/copilot")],
  },
  {
    label: "opencode",
    kind: "agent",
    matchers: [executable("opencode"), npmPackage("opencode-ai")],
  },
  {
    label: "Amp",
    kind: "agent",
    matchers: [executable("amp"), npmPackage("@sourcegraph/amp")],
  },
  {
    label: "Aider",
    kind: "agent",
    matchers: [executable("aider"), pythonModule("aider")],
  },
  {
    label: "Goose",
    kind: "agent",
    matchers: [executable("goose"), app("Goose")],
  },
  { label: "Crush", kind: "agent", matchers: [executable("crush")] },
  { label: "T3 Code", kind: "agent", matchers: [app("T3 Code")] },

  // Editors
  {
    label: "Cursor",
    kind: "editor",
    matchers: [app("Cursor"), executable("cursor-agent")],
  },
  {
    label: "VS Code",
    kind: "editor",
    matchers: [
      app("Visual Studio Code"),
      executable("code"),
      executable("code-server"),
    ],
  },
  { label: "Windsurf", kind: "editor", matchers: [app("Windsurf")] },
  { label: "Kiro", kind: "editor", matchers: [app("Kiro")] },
  { label: "Zed", kind: "editor", matchers: [app("Zed"), executable("zed")] },
  {
    label: "JetBrains",
    kind: "editor",
    matchers: [
      "IntelliJ IDEA",
      "WebStorm",
      "PyCharm",
      "GoLand",
      "RustRover",
      "PhpStorm",
      "Rider",
    ].map(app),
  },

  // Terminals
  { label: "tmux", kind: "terminal", matchers: [executable("tmux")] },
  {
    label: "Ghostty",
    kind: "terminal",
    matchers: [app("Ghostty"), executable("ghostty")],
  },
  { label: "iTerm", kind: "terminal", matchers: [app("iTerm")] },
  { label: "Terminal", kind: "terminal", matchers: [app("Terminal")] },
  {
    label: "WezTerm",
    kind: "terminal",
    matchers: [
      app("WezTerm"),
      executable("wezterm"),
      executable("wezterm-gui"),
    ],
  },
  {
    label: "kitty",
    kind: "terminal",
    matchers: [app("kitty"), executable("kitty")],
  },
  {
    label: "Alacritty",
    kind: "terminal",
    matchers: [app("Alacritty"), executable("alacritty")],
  },
  { label: "Warp", kind: "terminal", matchers: [app("Warp")] },
];

const matches = (launcher: KnownLauncher, command: string): boolean =>
  launcher.matchers.some((matcher) => matcher.test(command));

/**
 * Whether `command` is plausibly the launcher called `label`. Guards against a
 * dead agent's pid having been reused by an unrelated process.
 */
export const isLauncherProcess = (label: string, command: string): boolean =>
  knownLaunchers.some(
    (launcher) => launcher.label === label && matches(launcher, command),
  );

interface EnvironmentMarker {
  readonly label: string;
  /** Presence of this variable identifies the agent. */
  readonly key: string;
  readonly pidKey?: string;
  readonly sessionKey?: string;
}

/**
 * Agents export markers into the shells they spawn, and children inherit them.
 * This still identifies the agent after a server has been detached and
 * re-parented to PID 1, which is what happens to backgrounded dev servers.
 */
const environmentMarkers: ReadonlyArray<EnvironmentMarker> = [
  {
    label: "Claude Code",
    key: "CLAUDECODE",
    pidKey: "CLAUDE_PID",
    sessionKey: "CLAUDE_CODE_SESSION_ID",
  },
  { label: "Codex", key: "CODEX_THREAD_ID", sessionKey: "CODEX_THREAD_ID" },
  { label: "Codex", key: "CODEX_SANDBOX" },
  { label: "Gemini CLI", key: "GEMINI_CLI" },
  { label: "Cursor", key: "CURSOR_AGENT" },
];

/** Emerging cross-agent convention, e.g. `AI_AGENT=claude-code_2-1-301_agent`. */
const genericAgentKey = "AI_AGENT";

/** The only environment variables pls ever reads. */
export const environmentKeys: ReadonlyArray<string> = [
  genericAgentKey,
  ...environmentMarkers.flatMap(({ key, pidKey, sessionKey }) =>
    [key, pidKey ?? [], sessionKey ?? []].flat(),
  ),
];

const agentFromEnvironment = (
  environment: ReadonlyMap<string, string>,
): Launcher | null => {
  const marker = environmentMarkers.find(({ key }) => environment.has(key));

  if (marker !== undefined) {
    return new Launcher({
      label: marker.label,
      kind: "agent",
      pid:
        marker.pidKey === undefined
          ? null
          : parsePid(environment.get(marker.pidKey)),
      session:
        marker.sessionKey === undefined
          ? null
          : (environment.get(marker.sessionKey) ?? null),
      running: true,
    });
  }

  const genericAgent = environment.get(genericAgentKey);

  if (genericAgent === undefined || genericAgent === "") {
    return null;
  }

  // Values look like `claude-code_2-1-301_agent`; the name comes first.
  const [name = genericAgent] = genericAgent.split("_");

  return new Launcher({
    label: name,
    kind: "agent",
    pid: null,
    session: null,
    running: true,
  });
};

const nearestLauncherAncestor = (
  ancestry: ReadonlyArray<Pick<Ancestor, "pid" | "command">>,
): Launcher | null => {
  for (const ancestor of ancestry) {
    const launcher = knownLaunchers.find((known) =>
      matches(known, ancestor.command),
    );

    if (launcher !== undefined) {
      return new Launcher({
        label: launcher.label,
        kind: launcher.kind,
        pid: ancestor.pid,
        session: null,
        running: true,
      });
    }
  }

  return null;
};

/**
 * Picks what started a process, in order of confidence:
 * 1. an agent in the process tree (exact pid), enriched with the session id from its environment;
 * 2. an agent known only from inherited environment markers;
 * 3. the nearest editor or terminal in the process tree.
 */
export const detectLauncher = (
  ancestry: ReadonlyArray<Pick<Ancestor, "pid" | "command">>,
  environment: ReadonlyMap<string, string>,
): Launcher | null => {
  const fromTree = nearestLauncherAncestor(ancestry);
  const fromEnvironment = agentFromEnvironment(environment);

  if (fromTree?.kind !== "agent") {
    return fromEnvironment ?? fromTree;
  }

  if (fromEnvironment?.label !== fromTree.label) {
    return fromTree;
  }

  return new Launcher({ ...fromTree, session: fromEnvironment.session });
};

/** A short display name for a command line, e.g. `Ghostty` or `zsh`. */
export const shortName = (command: string): string => {
  // App bundle paths often contain spaces, so use the outermost bundle name rather than the first word.
  const appName = /^\/(?:[^/]+\/)*?([^/]+)\.app\//.exec(command)?.[1];

  if (appName !== undefined) {
    return appName;
  }

  const [executablePath = command] = command.split(/\s+/);

  // Login shells are listed as `-zsh`.
  return basename(executablePath).replace(/^-/, "");
};

const interpreter = /^(node|bun|deno|python[\d.]*|ruby|java|php|perl)$/i;

/**
 * What a process actually is: `node …/next/dist/bin/next dev` → `next`.
 * Anything that is not an interpreter is already descriptive and returned as-is.
 */
export const labelFor = (name: string, command: string): string =>
  interpreter.test(name) ? (scriptFromCommand(command) ?? name) : name;

/** Guesses which tool an interpreter is running, trying the most specific evidence first. */
const scriptFromCommand = (command: string): string | undefined => {
  // `node …/node_modules/.bin/vite`, but not pnpm's relative `.bin/../.pnpm/…` shim paths.
  const binShim = /node_modules\/\.bin\/([^\s/.][^\s/]*)(\s|$)/.exec(
    command,
  )?.[1];

  if (binShim !== undefined) {
    return binShim;
  }

  // `node …/.pnpm/vite@8/node_modules/vite/bin/vite.js`: the innermost package is the real one.
  const packages = Array.from(
    command.matchAll(/node_modules\/((?:@[^/\s]+\/)?[^/\s.][^/\s]*)\//g),
  );
  const innermostPackage = packages.at(-1)?.[1];

  if (innermostPackage !== undefined) {
    return innermostPackage;
  }

  // `python -m http.server`
  const module = /\s-m\s+([\w.]+)/.exec(command)?.[1];

  if (module !== undefined) {
    return module;
  }

  // `node server.js`: the first argument that is not a flag.
  const script = command
    .split(/\s+/)
    .slice(1)
    .find((argument) => !argument.startsWith("-"));

  return script === undefined ? undefined : basename(script);
};

const basename = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);
