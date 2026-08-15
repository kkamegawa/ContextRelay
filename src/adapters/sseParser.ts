/**
 * Pure, dependency-free parsing helpers for the Microsoft 365 Copilot Chat
 * API's `chatOverStream` endpoint (`text/event-stream`). Kept independent of
 * `fetch`/`ReadableStream` so the framing and payload-extraction logic can be
 * unit tested without a network stub.
 */

export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Incremental parser for `text/event-stream` bodies. Feed it raw text
 * chunks as they arrive over the wire; it returns any complete events found
 * so far and retains a partial trailing frame internally for the next
 * push(). Frames are separated by a blank line (`\n\n`); this also copes
 * with chunk boundaries that land mid-frame or mid-line.
 */
export class SseFrameParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];

    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const event = parseFrame(frame);
      if (event) {
        events.push(event);
      }
      boundary = this.buffer.indexOf('\n\n');
    }

    return events;
  }

  /** Parse whatever partial frame remains once the stream has ended. */
  flush(): SseEvent[] {
    const remaining = this.buffer;
    this.buffer = '';
    if (!remaining.trim()) {
      return [];
    }

    const event = parseFrame(remaining);
    return event ? [event] : [];
  }
}

function parseFrame(frame: string): SseEvent | undefined {
  const dataLines: string[] = [];
  let eventName: string | undefined;

  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    } else if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    }
    // id:, retry:, comment lines (":") and blank lines are intentionally ignored.
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return { event: eventName, data: dataLines.join('\n') };
}

/**
 * Extract the latest non-empty assistant reply text from a decoded
 * `data:` payload representing a `copilotConversation` snapshot — mirroring
 * the "last message that isn't the echoed prompt" selection the synchronous
 * `/chat` endpoint response uses. Each streamed frame carries the full
 * conversation-so-far per the Chat API docs, so the returned string is the
 * cumulative reply text as of that frame, not a delta.
 */
export function extractLatestReplyText(json: unknown, sentPrompt: string): string | undefined {
  if (!json || typeof json !== 'object') {
    return undefined;
  }

  const messages = (json as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return undefined;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const text = (messages[i] as { text?: unknown } | undefined)?.text;
    if (typeof text === 'string' && text.trim().length > 0 && text !== sentPrompt) {
      return text;
    }
  }

  return undefined;
}
