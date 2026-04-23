export type RouteTarget =
  | 'mail'
  | 'teams'
  | 'sharepoint'
  | 'onedrive'
  | 'onenote'
  | 'planner'
  | 'task'
  | 'all'
  | 'ask'
  | 'clear';

export interface ParsedCommand {
  target: RouteTarget;
  query: string;
  isEmpty: boolean;
}

const SLASH_COMMANDS: Record<string, RouteTarget> = {
  mail: 'mail',
  teams: 'teams',
  sharepoint: 'sharepoint',
  onedrive: 'onedrive',
  onenote: 'onenote',
  task: 'task',
  all: 'all',
  ask: 'ask',
  clear: 'clear'
};

function normalizeQuery(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  const normalized = normalizeQuery(trimmed);

  if (trimmed.startsWith('/')) {
    const commandMatch = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    const command = commandMatch?.[1]?.toLowerCase() ?? trimmed.slice(1).toLowerCase();
    const rawQuery = commandMatch?.[2] ?? '';
    // For /ask, preserve newlines in the user's instruction so the prompt keeps its original shape.
    const target = SLASH_COMMANDS[command];
    const query = target === 'ask'
      ? rawQuery.trim()
      : target === 'clear'
        ? ''
        : normalizeQuery(rawQuery);

    if (target) {
      // /clear takes no arguments and is never treated as empty so it always executes.
      const isEmpty = target === 'clear' ? false : query.length === 0;
      return { target, query, isEmpty };
    }
    // Unknown slash command — treat as /all with the original input
    return { target: 'all', query: normalized, isEmpty: normalized.length === 0 };
  }

  return { target: 'all', query: normalized, isEmpty: normalized.length === 0 };
}

export function getHelpText(command: string): string {
  const examples: Record<string, string> = {
    mail: 'Example: /mail from:alice subject:budget\nExample: /mail incident review',
    teams: 'Example: /teams sprint review\nExample: /teams from:bob mentions:me',
    sharepoint: 'Example: /sharepoint VPN setup guide\nExample: /sharepoint architecture',
    onedrive: 'Example: /onedrive architecture diagram\nExample: /onedrive Q3 report',
    onenote: 'Example: /onenote architecture decision log\nExample: /onenote section notebook architecture',
    planner: 'Example: /task release checklist\nExample: /task metadata comments onboarding',
    task: 'Example: /task release checklist\nExample: /task metadata comments onboarding',
    all: 'Example: /all architecture decisions\nOr just type a query without a slash command.',
    ask: 'Example: /ask 日本語に翻訳してmarkdownにして\nExample: /ask Summarize the pinned docs as a bullet list\nPinned snippets are used as context and the Microsoft 365 Copilot response is opened in a new editor tab.',
    clear: 'Example: /clear\nClears the current chat transcript and discards all pinned snippets.'
  };
  return examples[command] ?? 'Type a query to search Microsoft 365 content.';
}
