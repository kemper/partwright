// Slash-command parsing for the AI chat input. Pure logic — no DOM, no app
// state — so it lives in the fast unit tier (tests/unit/slashCommands.test.ts).
// The panel (src/ui/aiPanel.ts) owns the handlers and the autocomplete menu;
// the command *names + descriptions* are defined here and the panel's handler
// map is type-checked against `SlashCommandName`, so a command can't be
// half-wired (a name with no handler, or a handler with no name).

export interface SlashCommandSpec {
  /** Canonical name, without the leading slash. */
  name: string;
  /** One-line description shown in /help and the autocomplete menu. */
  summary: string;
  /** Alternate spellings (without the slash) that resolve to this command. */
  aliases?: readonly string[];
}

/** The slash commands offered in the AI input. Each mirrors a one-click
 *  header action so the whole chat-management surface is keyboard-reachable.
 *  Order is the display order in /help and the autocomplete menu. */
export const SLASH_COMMANDS = [
  { name: 'compact', summary: 'Summarize older turns and promote insights to session notes' },
  { name: 'clear', summary: 'Delete this chat from your browser (saved versions & notes are kept)' },
  { name: 'review', summary: 'Have a different provider/model review the current session' },
  { name: 'export', summary: 'Download the conversation as a Markdown file' },
  { name: 'models', summary: 'Open AI settings — provider, model, and API key', aliases: ['model', 'settings'] },
  { name: 'help', summary: 'List the available slash commands', aliases: ['commands'] },
] as const satisfies readonly SlashCommandSpec[];

export type SlashCommandName = (typeof SLASH_COMMANDS)[number]['name'];

/** The commands as a uniform `SlashCommandSpec[]` view. `SLASH_COMMANDS` is
 *  `as const` so `SlashCommandName` can be derived as a literal union, but that
 *  narrow type means members declared without `aliases` have no such property —
 *  iterating through this widened view lets the helpers read `.aliases`
 *  uniformly. */
const COMMAND_SPECS: readonly SlashCommandSpec[] = SLASH_COMMANDS;

/** Resolve a typed token (canonical name or alias, case-insensitive) to its
 *  canonical command name, or null if it matches nothing. */
export function resolveSlashCommand(token: string): SlashCommandName | null {
  const t = token.toLowerCase();
  for (const cmd of COMMAND_SPECS) {
    if (cmd.name === t) return cmd.name as SlashCommandName;
    if (cmd.aliases?.some((a) => a === t)) return cmd.name as SlashCommandName;
  }
  return null;
}

export interface ParsedSlashCommand {
  /** Canonical command name if the token matched one, else null (unknown). */
  name: SlashCommandName | null;
  /** The bareword the user typed after '/', lowercased (for feedback). */
  token: string;
}

/** Parse a committed input as a slash command. Returns null when the text is
 *  not a slash-command invocation at all — i.e. it isn't a single bare
 *  "/word" token (with optional surrounding whitespace). That guard keeps a
 *  normal message that merely *starts* with a slash — a path like
 *  "/usr/bin/env ..." or a phrase like "/think it over" — from being
 *  hijacked: only a lone "/word" is a command. An unknown bare word still
 *  returns a result (with `name: null`) so the caller can warn rather than
 *  silently forward "/flush" to the model. */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const match = /^\s*\/([a-zA-Z][\w-]*)\s*$/.exec(text);
  if (!match) return null;
  const token = match[1].toLowerCase();
  return { name: resolveSlashCommand(token), token };
}

/** Commands whose name or an alias starts with `prefix` (case-insensitive,
 *  no slash). An empty prefix returns every command. Definition order is
 *  preserved. Drives the autocomplete menu. */
export function matchSlashCommands(prefix: string): SlashCommandSpec[] {
  const p = prefix.toLowerCase();
  if (p === '') return [...COMMAND_SPECS];
  return COMMAND_SPECS.filter(
    (cmd) => cmd.name.startsWith(p) || (cmd.aliases?.some((a) => a.startsWith(p)) ?? false),
  );
}

/** For the live autocomplete menu: given the current raw input, return the
 *  command-name prefix to filter by, or null when the menu should be hidden.
 *  The menu shows only while the user is still typing the command token —
 *  "/", "/cl", "/clear" — and hides the moment a space is typed (the token is
 *  complete; anything after it is arguments) or the text isn't a leading
 *  slash token at all. */
export function slashMenuPrefix(text: string): string | null {
  const match = /^\/([a-zA-Z][\w-]*)?$/.exec(text);
  return match ? (match[1] ?? '').toLowerCase() : null;
}
