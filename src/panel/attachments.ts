import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { isCopilotSupportedFileExtension } from './copilotSupportedExtensions';
import { resolveWorkspaceFile, toDisplayRelativePath } from './workspacePath';

/**
 * Where a resolved attachment came from. `#file` mentions typed in the
 * prompt, files dropped onto the input, files picked from the attach-file
 * button, and the (opt-in) active-editor auto-attach all funnel into the
 * same ResolvedAttachment shape so downstream code (chatContext.ts) only
 * has one type to deal with.
 */
export type AttachmentOrigin = 'mention' | 'drop' | 'picker' | 'activeEditor';

export interface AttachmentSelection {
  /** 1-indexed, inclusive. */
  startLine: number;
  /** 1-indexed, inclusive. */
  endLine: number;
}

export interface ResolvedAttachment {
  absolutePath: string;
  workspaceRoot: string;
  relativePath: string;
  uri: string;
  origin: AttachmentOrigin;
  selection?: AttachmentSelection;
}

/** Default cap on attachments per message; overridable via contextRelay.chat.maxAttachedFiles. */
export const DEFAULT_MAX_ATTACHMENTS = 5;

/**
 * Resolve a single absolute filesystem path (from drag-and-drop, the attach
 * picker, or the active editor) into a ResolvedAttachment. Applies the same
 * workspace-containment, symlink-realpath, and Copilot-supported-extension
 * checks as `#` mentions in fileMentions.ts.
 */
export async function resolveAttachmentPath(
  absolutePath: string,
  workspaceRoots: readonly string[],
  origin: AttachmentOrigin,
  selection?: AttachmentSelection
): Promise<ResolvedAttachment | string> {
  if (workspaceRoots.length === 0) {
    return 'Attaching local files requires an opened workspace folder.';
  }

  // Resolve roots to their real (symlink-free, canonical) form first —
  // resolveWorkspaceFile realpaths the candidate file but not the roots, and
  // on some platforms (e.g. Windows short 8.3-style temp paths) a raw
  // workspace folder path and a realpath'd file inside it can otherwise fail
  // to line up, incorrectly rejecting a file that is actually in-workspace.
  const normalizedRoots = await Promise.all(
    workspaceRoots.map(async root => {
      try {
        return await fs.realpath(root);
      } catch {
        return root;
      }
    })
  );

  const resolved = await resolveWorkspaceFile(path.resolve(absolutePath), normalizedRoots, {
    label: absolutePath
  });
  if (typeof resolved === 'string') {
    return resolved;
  }

  if (!isCopilotSupportedFileExtension(resolved.canonicalPath)) {
    return `Unsupported file type for ${absolutePath}. Only Copilot-supported file extensions are allowed.`;
  }

  return {
    absolutePath: resolved.canonicalPath,
    workspaceRoot: resolved.workspaceRoot,
    relativePath: toDisplayRelativePath(resolved.workspaceRoot, resolved.canonicalPath),
    uri: pathToFileURL(resolved.canonicalPath).toString(),
    origin,
    selection
  };
}

/**
 * Merge attachments gathered from multiple origins (mentions, drops,
 * picker, active editor), de-duplicating by canonical absolute path so the
 * same file attached twice — e.g. via `#mention` and drag-and-drop — is
 * only sent once. Later groups win on conflict, so a fresh drop or picker
 * selection can refresh a stale mention/selection range.
 */
export function mergeAttachments(
  ...groups: readonly (readonly ResolvedAttachment[])[]
): ResolvedAttachment[] {
  const byPath = new Map<string, ResolvedAttachment>();
  for (const group of groups) {
    for (const attachment of group) {
      byPath.set(attachment.absolutePath, attachment);
    }
  }
  return [...byPath.values()];
}
