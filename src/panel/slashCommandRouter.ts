import {
  SLASH_COMMANDS,
  type ContextSource,
  type SlashCommand,
} from './types';

export interface ParsedCommand {
  slashCommand: SlashCommand | undefined;
  query: string;
  targetSources: ContextSource[];
}

const ALL_SOURCES: ContextSource[] = ['sharepoint', 'onedrive', 'onenote', 'planner', 'mail', 'teams'];

/**
 * Parse user input and route to the appropriate adapter(s).
 * Follows the routing rules from plan.md Section 4.2.
 */
export function parseSlashCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return {
      slashCommand: undefined,
      query: trimmed,
      targetSources: ALL_SOURCES,
    };
  }

  const spaceIndex = trimmed.indexOf(' ');
  const commandPart = spaceIndex === -1 ? trimmed : trimmed.substring(0, spaceIndex);
  const query = spaceIndex === -1 ? '' : trimmed.substring(spaceIndex + 1).trim();

  const matched = SLASH_COMMANDS.find(
    (cmd) => cmd.command === commandPart.toLowerCase()
  );

  if (!matched) {
    // Unknown slash command — treat the whole input as a query for all sources
    return {
      slashCommand: undefined,
      query: trimmed,
      targetSources: ALL_SOURCES,
    };
  }

  const targetSources: ContextSource[] =
    matched.source === 'all' || !matched.source
      ? ALL_SOURCES
      : [matched.source];

  return {
    slashCommand: matched,
    query,
    targetSources,
  };
}

/**
 * Get inline help examples for a slash command.
 */
export function getSlashHelp(commandName: string): string[] {
  switch (commandName) {
    case '/mail':
      return [
        '/mail project kickoff notes',
        '/mail from:alice subject:budget',
      ];
    case '/teams':
      return [
        '/teams sprint review decisions',
        '/teams from:bob sent>2024-01-01',
      ];
    case '/sharepoint':
      return [
        '/sharepoint API design document',
        '/sharepoint VPN setup guide',
      ];
    case '/onedrive':
      return [
        '/onedrive architecture diagram',
        '/onedrive quarterly report',
      ];
    case '/all':
      return [
        '/all architecture decisions',
        '/all incident review',
      ];
    case '/onenote':
      return [
        '/onenote architecture decision log',
        '/onenote section notebook architecture',
      ];
    case '/task':
      return [
        '/task release checklist',
        '/task metadata comments onboarding',
      ];
    default:
      return [];
  }
}
