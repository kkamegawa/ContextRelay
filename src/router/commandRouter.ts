export type RouteTarget = 'mail' | 'teams' | 'sharepoint' | 'onedrive' | 'all';

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
  all: 'all'
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
    const query = normalizeQuery(commandMatch?.[2] ?? '');
    const target = SLASH_COMMANDS[command];

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
    all: 'Example: /all architecture decisions\nOr just type a query without a slash command.'
  };
  return examples[command] ?? 'Type a query to search Microsoft 365 content.';
}
