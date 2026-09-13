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

export interface BoundedFileRead {
  text: string;
  /** True when the file (or selected range) had more content than was read. */
  truncated: boolean;
}

/**
 * Read a previously validated workspace file without trusting that its path
 * still points at the same file. The file is opened first; then its real
 * path must still equal `canonicalPath` and lie inside `workspaceRoot`, and
 * the open handle must refer to the same file (device and inode) as that
 * real path. A path that was moved, deleted, or swapped for a symlink since
 * validation is therefore rejected instead of read.
 *
 * Reads are bounded: without `selection`, only enough bytes to produce more
 * than `maxChars` characters are read; with `selection` (1-indexed,
 * inclusive lines), lines are streamed and collection stops after the range
 * or once more than `maxChars` characters were collected. Returns
 * `undefined` when the file cannot be read or no longer passes validation.
 */
export async function readValidatedWorkspaceFile(
  canonicalPath: string,
  workspaceRoot: string,
  maxChars: number,
  selection?: { startLine: number; endLine: number }
): Promise<BoundedFileRead | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(canonicalPath, 'r');
    const realPath = await fs.realpath(canonicalPath);
    if (path.resolve(realPath) !== path.resolve(canonicalPath) || !isPathWithinRoot(realPath, workspaceRoot)) {
      return undefined;
    }

    const [opened, current] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.stat(realPath, { bigint: true })
    ]);
    if (!opened.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) {
      return undefined;
    }

    return selection
      ? await readSelectedLines(handle, selection, maxChars)
      : await readPrefix(handle, opened.size, maxChars);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readPrefix(handle: fs.FileHandle, size: bigint, maxChars: number): Promise<BoundedFileRead> {
  // UTF-8 uses at most 4 bytes per character, so reading this many bytes
  // always yields more than maxChars characters when the file is larger.
  const maxBytes = BigInt(maxChars * 4 + 4);
  const length = Number(size < maxBytes ? size : maxBytes);
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, 0);
  return {
    text: buffer.subarray(0, bytesRead).toString('utf8'),
    truncated: size > BigInt(bytesRead)
  };
}

async function readSelectedLines(
  handle: fs.FileHandle,
  selection: { startLine: number; endLine: number },
  maxChars: number
): Promise<BoundedFileRead> {
  const collected: string[] = [];
  let collectedChars = 0;
  let lineNumber = 0;
  let truncated = false;

  for await (const line of handle.readLines({ encoding: 'utf8', autoClose: false })) {
    lineNumber += 1;
    if (lineNumber < selection.startLine) {
      continue;
    }
    if (lineNumber > selection.endLine) {
      break;
    }

    collected.push(line);
    collectedChars += line.length + 1;
    if (collectedChars > maxChars) {
      truncated = lineNumber < selection.endLine;
      break;
    }
  }

  return { text: collected.join('\n'), truncated };
}
