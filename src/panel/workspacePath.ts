import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Shared filesystem-path primitives used by every way a local file can be
 * attached to a Copilot request (# mentions, drag-and-drop, the attach-file
 * picker, and the active-editor auto-attach). Keeping these in one place
 * means every attachment origin gets the same workspace-containment and
 * symlink-realpath guarantees.
 */

export interface ValidatedWorkspaceFile {
  canonicalPath: string;
  workspaceRoot: string;
}

export async function safeStat(candidatePath: string): Promise<import('fs').Stats | undefined> {
  try {
    return await fs.stat(candidatePath);
  } catch {
    return undefined;
  }
}

export function isPathWithinRoot(candidatePath: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, candidatePath);
  if (relative === '') {
    return true;
  }
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function findContainingWorkspaceRoot(
  candidatePath: string,
  workspaceRoots: readonly string[]
): string | undefined {
  return workspaceRoots.find(root => isPathWithinRoot(candidatePath, root));
}

export function toDisplayRelativePath(workspaceRoot: string, absolutePath: string): string {
  const relative = path.relative(workspaceRoot, absolutePath);
  return relative.split(path.sep).join('/');
}

/**
 * Validate that `candidatePath` exists, is a regular file, and (after
 * resolving symlinks) lives inside one of `workspaceRoots`. Returns the
 * canonical (symlink-resolved) path and owning root, or a human-readable
 * error string. Extension-allowlist checks are the caller's responsibility,
 * since callers currently agree on the Copilot-supported-extensions list
 * but that is a policy decision, not a path-validation one.
 */
export async function resolveWorkspaceFile(
  candidatePath: string,
  workspaceRoots: readonly string[],
  options: { preferredRoot?: string; label?: string } = {}
): Promise<ValidatedWorkspaceFile | string> {
  const label = options.label ?? candidatePath;

  const stat = await safeStat(candidatePath);
  if (!stat || !stat.isFile()) {
    return `File not found for ${label}.`;
  }

  const canonicalPath = await fs.realpath(candidatePath);
  const workspaceRoot = options.preferredRoot ?? findContainingWorkspaceRoot(canonicalPath, workspaceRoots);
  if (!workspaceRoot || !isPathWithinRoot(canonicalPath, workspaceRoot)) {
    return `File ${label} is outside the opened workspace.`;
  }

  return { canonicalPath, workspaceRoot };
}
