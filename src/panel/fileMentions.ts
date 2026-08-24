import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { normalizeExtractedText } from '../textExtraction';
import { type ResolvedAttachment } from './attachments';
import { isCopilotSupportedFileExtension } from './copilotSupportedExtensions';
import { resolveWorkspaceFile, toDisplayRelativePath } from './workspacePath';

const FILE_MENTION_PATTERN = /(^|\s)#(?:"([^"]+)"|'([^']+)'|([^\s#]+))/g;
const ONLY_DIGITS_PATTERN = /^\d+$/;

export const MAX_FILE_MENTIONS = 5;
export const MAX_WORKIQ_FILE_CONTEXT_CHARS = 12_000;
export const MAX_WORKIQ_FILE_CHARS = 4_000;

export interface FileMentionCandidate {
  rawPath: string;
  removeStart: number;
  removeEnd: number;
}

export interface ResolveFileMentionResult {
  cleanedPrompt: string;
  files: ResolvedAttachment[];
  errors: string[];
}

interface FileMatch {
  candidatePath: string;
  workspaceRoot: string;
  canonicalPath: string;
}

export function extractFileMentionCandidates(input: string): FileMentionCandidate[] {
  const candidates: FileMentionCandidate[] = [];
  for (const match of input.matchAll(FILE_MENTION_PATTERN)) {
    const prefix = match[1] ?? '';
    const rawPath = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!rawPath || ONLY_DIGITS_PATTERN.test(rawPath)) {
      continue;
    }

    const tokenStart = (match.index ?? 0) + prefix.length;
    const tokenEnd = (match.index ?? 0) + match[0].length;
    candidates.push({
      rawPath,
      removeStart: tokenStart,
      removeEnd: tokenEnd
    });
  }

  return candidates;
}

export async function resolveFileMentions(
  input: string,
  workspaceRoots: readonly string[]
): Promise<ResolveFileMentionResult> {
  const candidates = extractFileMentionCandidates(input);
  if (candidates.length === 0) {
    return {
      cleanedPrompt: input.trim(),
      files: [],
      errors: []
    };
  }

  if (workspaceRoots.length === 0) {
    return {
      cleanedPrompt: stripMentionTokens(input, candidates),
      files: [],
      errors: ['# file mentions require an opened workspace folder.']
    };
  }

  if (candidates.length > MAX_FILE_MENTIONS) {
    return {
      cleanedPrompt: stripMentionTokens(input, candidates),
      files: [],
      errors: [`You can reference up to ${MAX_FILE_MENTIONS} files per message.`]
    };
  }

  const normalizedRoots = await Promise.all(workspaceRoots.map(root => fs.realpath(root)));
  const files: ResolvedAttachment[] = [];
  const errors: string[] = [];
  const seenUris = new Set<string>();

  for (const candidate of candidates) {
    const match = await resolveSingleMention(candidate.rawPath, normalizedRoots);
    if (typeof match === 'string') {
      errors.push(match);
      continue;
    }

    const uri = pathToFileURL(match.canonicalPath).toString();
    if (seenUris.has(uri)) {
      continue;
    }
    seenUris.add(uri);

    files.push({
      absolutePath: match.canonicalPath,
      workspaceRoot: match.workspaceRoot,
      relativePath: toDisplayRelativePath(match.workspaceRoot, match.canonicalPath),
      uri,
      origin: 'mention'
    });
  }

  return {
    cleanedPrompt: stripMentionTokens(input, candidates),
    files,
    errors
  };
}

export async function buildWorkIqPromptWithFiles(
  prompt: string,
  files: readonly ResolvedAttachment[]
): Promise<string> {
  if (files.length === 0) {
    return prompt;
  }

  let remainingBudget = MAX_WORKIQ_FILE_CONTEXT_CHARS;
  const sections: string[] = [];

  for (const file of files) {
    if (remainingBudget <= 0) {
      break;
    }

    const content = await fs.readFile(file.absolutePath, 'utf8');
    const normalized = normalizeExtractedText(content);
    const bounded = truncateForBudget(normalized || '(empty file)', Math.min(MAX_WORKIQ_FILE_CHARS, remainingBudget));
    if (!bounded.trim()) {
      continue;
    }

    sections.push(`[File: ${file.relativePath}]\n${bounded}`);
    remainingBudget -= bounded.length;
  }

  if (sections.length === 0) {
    return prompt;
  }

  return `${prompt}\n\nContextRelay local file context:\n${sections.join('\n\n')}`;
}

function stripMentionTokens(input: string, candidates: readonly FileMentionCandidate[]): string {
  if (candidates.length === 0) {
    return input.trim();
  }

  const sorted = [...candidates].sort((left, right) => left.removeStart - right.removeStart);
  let result = '';
  let cursor = 0;
  for (const candidate of sorted) {
    result += input.slice(cursor, candidate.removeStart);
    cursor = candidate.removeEnd;
  }
  result += input.slice(cursor);
  return result.replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
}

async function resolveSingleMention(rawPath: string, workspaceRoots: readonly string[]): Promise<FileMatch | string> {
  const possibleMatches: FileMatch[] = [];
  const isAbsolute = path.isAbsolute(rawPath);

  if (isAbsolute) {
    const candidatePath = path.resolve(rawPath);
    const candidateMatch = await resolveCandidatePath(candidatePath, workspaceRoots);
    if (typeof candidateMatch === 'string') {
      return candidateMatch;
    }
    possibleMatches.push(candidateMatch);
  } else {
    for (const workspaceRoot of workspaceRoots) {
      const candidatePath = path.resolve(workspaceRoot, rawPath);
      const candidateMatch = await resolveCandidatePath(candidatePath, workspaceRoots, workspaceRoot);
      if (typeof candidateMatch === 'string') {
        continue;
      }
      possibleMatches.push(candidateMatch);
    }
  }

  if (possibleMatches.length === 0) {
    return `File not found for #${rawPath}.`;
  }

  if (!isAbsolute && possibleMatches.length > 1) {
    return `File path "#${rawPath}" is ambiguous across workspace folders. Use a unique path.`;
  }

  const selected = possibleMatches[0];
  if (!isCopilotSupportedFileExtension(selected.canonicalPath)) {
    return `Unsupported file type for #${rawPath}. Only Copilot-supported file extensions are allowed.`;
  }

  return selected;
}

async function resolveCandidatePath(
  candidatePath: string,
  workspaceRoots: readonly string[],
  preferredRoot?: string
): Promise<FileMatch | string> {
  const resolved = await resolveWorkspaceFile(candidatePath, workspaceRoots, {
    preferredRoot,
    label: `#${candidatePath}`
  });
  if (typeof resolved === 'string') {
    return resolved;
  }

  return {
    candidatePath,
    workspaceRoot: resolved.workspaceRoot,
    canonicalPath: resolved.canonicalPath
  };
}

function truncateForBudget(value: string, budget: number): string {
  if (budget <= 0) {
    return '';
  }
  if (value.length <= budget) {
    return value;
  }

  const suffix = `\n[truncated ${value.length - budget} chars]`;
  if (suffix.length >= budget) {
    return suffix.slice(0, budget);
  }
  return `${value.slice(0, budget - suffix.length)}${suffix}`;
}

