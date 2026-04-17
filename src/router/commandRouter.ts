export type RouteTarget = 'mail' | 'teams' | 'sharepoint' | 'onedrive' | 'all' | 'ask';

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
  all: 'all',
  ask: 'ask'
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
    const query = target === 'ask' ? rawQuery.trim() : normalizeQuery(rawQuery);

    if (target) {
      return { target, query, isEmpty: query.length === 0 };
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
    all: 'Example: /all architecture decisions\nOr just type a query without a slash command.',
    ask: 'Example: /ask 日本語に翻訳してmarkdownにして\nExample: /ask Summarize the pinned docs as a bullet list\nPinned snippets are used as context and the Microsoft 365 Copilot response is opened in a new editor tab.'
  };
  return examples[command] ?? 'Type a query to search Microsoft 365 content.';
}
