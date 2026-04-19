import type * as vscode from 'vscode';
import type { ViewLocation } from './chatMoveCommands';
import { VIEW_LOCATION_CONTEXT_KEY } from './chatViewConstants';

export function readStoredViewLocation(
  context: Pick<vscode.ExtensionContext, 'globalState'>
): ViewLocation {
  const stored = context.globalState.get<unknown>(VIEW_LOCATION_CONTEXT_KEY);

  return stored === 'auxiliarybar' || stored === 'sidebar' ? stored : 'sidebar';
}

export async function persistViewLocation(
  context: Pick<vscode.ExtensionContext, 'globalState'>,
  location: ViewLocation
): Promise<void> {
  await context.globalState.update(VIEW_LOCATION_CONTEXT_KEY, location);
}
