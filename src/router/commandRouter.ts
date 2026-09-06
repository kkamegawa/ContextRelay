import type { ContextSource } from '../models/contextItem';

export type RouteTarget =
  | 'chat'
  | 'mail'
  | 'teams'
  | 'sharepoint'
  | 'onedrive'
  | 'onenote'
  | 'planner'
  | 'task'
  | 'all'
  | 'ask'
  | 'clear'
  | 'workiq';

export type SearchCommandName = 'mail' | 'teams' | 'sharepoint' | 'onedrive' | 'onenote' | 'task' | 'all';
export type SearchScope = 'all' | 'scoped' | 'operation';

export interface ParsedCommand {
  target: RouteTarget;
  query: string;
  isEmpty: boolean;
  targetSources: ContextSource[];
  sourceCommands: SearchCommandName[];
  commandText?: string;
  searchScope: SearchScope;
}

const ALL_SOURCES: ContextSource[] = ['mail', 'teams', 'sharepoint', 'onedrive', 'onenote', 'planner', 'todo'];

const SEARCH_COMMAND_METADATA: Record<SearchCommandName, { target: RouteTarget; sources: ContextSource[] }> = {
  mail: { target: 'mail', sources: ['mail'] },
  teams: { target: 'teams', sources: ['teams'] },
  sharepoint: { target: 'sharepoint', sources: ['sharepoint'] },
  onedrive: { target: 'onedrive', sources: ['onedrive'] },
  onenote: { target: 'onenote', sources: ['onenote'] },
  task: { target: 'task', sources: ['planner', 'todo'] },
  all: { target: 'all', sources: ALL_SOURCES }
};

const OPERATION_COMMANDS: Record<string, RouteTarget> = {
  ask: 'ask',
  clear: 'clear',
  workiq: 'workiq'
};

function hasOwnKey<T extends object>(record: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeQuery(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  const normalized = normalizeQuery(trimmed);

  if (!trimmed.startsWith('/')) {
    return {
      target: 'chat',
      query: normalized,
      isEmpty: normalized.length === 0,
      targetSources: [],
      sourceCommands: [],
      searchScope: 'operation'
    };
  }

  const commandMatch = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  const firstCommand = commandMatch?.[1]?.toLowerCase() ?? trimmed.slice(1).toLowerCase();
  if (hasOwnKey(OPERATION_COMMANDS, firstCommand)) {
    const rawQuery = commandMatch?.[2] ?? '';
    const target = OPERATION_COMMANDS[firstCommand];
    const query = target === 'ask' || target === 'workiq' ? rawQuery.trim() : '';
    const isEmpty = target === 'clear' ? false : query.length === 0;

    return {
      target,
      query,
      isEmpty,
      targetSources: [],
      sourceCommands: [],
      commandText: `/${firstCommand}`,
      searchScope: 'operation'
    };
  }

  const tokens = trimmed.split(/\s+/);
  const commandNames: SearchCommandName[] = [];
  const seenCommands = new Set<SearchCommandName>();
  const queryTokens: string[] = [];

  for (const token of tokens) {
    if (queryTokens.length > 0) {
      queryTokens.push(token);
      continue;
    }

    if (!token.startsWith('/')) {
      queryTokens.push(token);
      continue;
    }

    const rawCommandName = token.slice(1).toLowerCase();
    if (!hasOwnKey(SEARCH_COMMAND_METADATA, rawCommandName)) {
      return buildFallbackQuery(normalized);
    }
    const commandName = rawCommandName;

    if (commandName === 'all') {
      if (commandNames.length > 0) {
        return buildFallbackQuery(normalized);
      }
    } else if (commandNames.includes('all')) {
      return buildFallbackQuery(normalized);
    }

    if (!seenCommands.has(commandName)) {
      seenCommands.add(commandName);
      commandNames.push(commandName);
    }
  }

  if (commandNames.length === 0) {
    return buildFallbackQuery(normalized);
  }

  const query = normalizeQuery(queryTokens.join(' '));
  const targetSources = expandSources(commandNames);
  const firstMetadata = SEARCH_COMMAND_METADATA[commandNames[0]];
  const target = commandNames.length === 1 ? firstMetadata.target : 'all';
  const searchScope: SearchScope = commandNames.length === 1 && commandNames[0] === 'all' ? 'all' : 'scoped';

  return {
    target,
    query,
    isEmpty: query.length === 0,
    targetSources,
    sourceCommands: commandNames,
    commandText: commandNames.map(command => `/${command}`).join(' '),
    searchScope
  };
}

function buildFallbackQuery(normalized: string): ParsedCommand {
  return {
    target: 'all',
    query: normalized,
    isEmpty: normalized.length === 0,
    targetSources: ALL_SOURCES,
    sourceCommands: [],
    searchScope: 'all'
  };
}

function expandSources(commandNames: readonly SearchCommandName[]): ContextSource[] {
  const expanded: ContextSource[] = [];
  const seenSources = new Set<ContextSource>();

  for (const commandName of commandNames) {
    for (const source of SEARCH_COMMAND_METADATA[commandName].sources) {
      if (!seenSources.has(source)) {
        seenSources.add(source);
        expanded.push(source);
      }
    }
  }

  return expanded;
}

export function getHelpText(command: string | readonly SearchCommandName[]): string {
  if (Array.isArray(command)) {
    return getScopedHelpText(command);
  }

  const commandName = command as string;

  const examples: Record<string, string> = {
    mail: 'Example: /mail from:alice subject:budget\nExample: /mail incident review',
    teams: 'Example: /teams sprint review\nExample: /teams from:bob mentions:me',
    sharepoint: 'Example: /sharepoint VPN setup guide\nExample: /sharepoint architecture',
    onedrive: 'Example: /onedrive architecture diagram\nExample: /onedrive Q3 report',
    onenote: 'Example: /onenote architecture decision log\nExample: /onenote section notebook architecture',
    planner: 'Example: /task release checklist\nExample: /task metadata comments onboarding',
    task: 'Example: /task release checklist\nExample: /task metadata comments onboarding',
    all: 'Example: /all architecture decisions\nExample: /mail /onedrive architecture decisions\nPlain text without a slash command starts or continues a Microsoft 365 Copilot chat. Pinned snippets and `#file` mentions, if any, are attached as context automatically.',
    ask: 'Example: /ask 日本語に翻訳してmarkdownにして\nExample: /ask #README.md Summarize this file as a bullet list\nPinned snippets or `#file` mentions are used as context and the Microsoft 365 Copilot response is shown in the panel. Plain chat attaches the same context automatically, so /ask is only needed to require that context be present before sending.',
    clear: 'Example: /clear\nClears the current chat transcript and discards all pinned snippets.',
    workiq: 'Example: /workiq Summarize my recent emails from Alice\nExample: /workiq What meetings do I have today?\nSends a natural language query to the Work IQ Gateway (A2A protocol). Requires Microsoft 365 Copilot license.'
  };
  return examples[commandName] ?? 'Type a query to search Microsoft 365 content.';
}

function getScopedHelpText(commands: readonly SearchCommandName[]): string {
  if (commands.length === 0) {
    return 'Type a query to search Microsoft 365 content.';
  }

  if (commands.length === 1) {
    return getHelpText(commands[0]);
  }

  const prefix = commands.map(command => `/${command}`).join(' ');
  return [
    `Example: ${prefix} architecture decisions`,
    `Example: ${prefix} incident review`,
    'Searches only the explicitly requested sources.'
  ].join('\n');
}
