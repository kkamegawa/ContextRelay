import { strict as assert } from 'assert';
import {
  ChatMoveRuntime,
  ViewLocation,
  moveChatToPrimarySideBar,
  moveChatToSecondarySideBar,
  openChatInEditorArea,
  openChatInNewWindow
} from '../../panel/chatMoveCommands';
import {
  CHAT_VIEW_ID,
  PRIMARY_SIDEBAR_CONTAINER_ID,
  SECONDARY_SIDEBAR_CONTAINER_ID
} from '../../panel/chatViewConstants';

suite('Chat move commands', () => {
  const createRuntime = () => {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    let editorOpens = 0;
    let focusCalls = 0;
    let auxBarFocusCalls = 0;
    const locationHistory: ViewLocation[] = [];

    const runtime: ChatMoveRuntime = {
      executeCommand: async (command: string, ...args: unknown[]) => {
        calls.push({ command, args });
      },
      focusView: async () => {
        focusCalls += 1;
      },
      focusAuxiliaryBar: async () => {
        auxBarFocusCalls += 1;
      },
      setViewLocation: async (location: ViewLocation) => {
        locationHistory.push(location);
      },
      openInEditorArea: async () => {
        editorOpens += 1;
      }
    };

    return {
      runtime,
      calls,
      locationHistory,
      get editorOpens() {
        return editorOpens;
      },
      get focusCalls() {
        return focusCalls;
      },
      get auxBarFocusCalls() {
        return auxBarFocusCalls;
      }
    };
  };

  test('moves the chat view back to the primary sidebar container', async () => {
    const harness = createRuntime();

    await moveChatToPrimarySideBar(harness.runtime);

    assert.deepEqual(harness.calls, [
      {
        command: 'vscode.moveViews',
        args: [{
          viewIds: [CHAT_VIEW_ID],
          destinationId: PRIMARY_SIDEBAR_CONTAINER_ID
        }]
      }
    ]);
    assert.deepEqual(harness.locationHistory, ['sidebar']);
    assert.equal(harness.focusCalls, 1);
  });

  test('moves the chat view to the dedicated secondary sidebar container', async () => {
    const harness = createRuntime();

    await moveChatToSecondarySideBar(harness.runtime);

    assert.deepEqual(harness.calls, [
      {
        command: 'vscode.moveViews',
        args: [{
          viewIds: [CHAT_VIEW_ID],
          destinationId: SECONDARY_SIDEBAR_CONTAINER_ID
        }]
      }
    ]);
    assert.deepEqual(harness.locationHistory, ['auxiliarybar']);
    assert.equal(harness.auxBarFocusCalls, 1, 'must focus the auxiliary bar after moving');
    assert.equal(harness.focusCalls, 1);
    assert.ok(
      !SECONDARY_SIDEBAR_CONTAINER_ID.startsWith('_.'),
      'secondary sidebar moves must use a real container ID, not a pseudo destination'
    );
  });

  test('opens chat in the editor area without relying on a pseudo move target', async () => {
    const harness = createRuntime();

    await openChatInEditorArea(harness.runtime);

    assert.equal(harness.editorOpens, 1);
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.focusCalls, 0);
  });

  test('opens chat in a new window by creating an editor surface first', async () => {
    const harness = createRuntime();

    await openChatInNewWindow(harness.runtime);

    assert.equal(harness.editorOpens, 1);
    assert.deepEqual(harness.calls, [
      {
        command: 'workbench.action.moveEditorToNewWindow',
        args: []
      }
    ]);
  });
});
