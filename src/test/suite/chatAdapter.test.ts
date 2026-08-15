import { strict as assert } from 'assert';
import { createConversation, sendMessage, sendMessageAuto, sendMessageStream, StreamAcceptedError } from '../../adapters/chatAdapter';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function installFetchStub(
  responder: (req: CapturedRequest) => { status: number; body: unknown }
): { restore: () => void; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input);
    const req: CapturedRequest = { url, init: init ?? {} };
    captured.push(req);
    const { status, body } = responder(req);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof globalThis.fetch;

  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    captured
  };
}

/** Builds an SSE (text/event-stream) response body from raw `data:` payload strings. */
function sseBody(frames: string[]): string {
  return frames.map(frame => `data: ${frame}\n\n`).join('');
}

function installStreamingFetchStub(
  responder: (req: CapturedRequest) => { status: number; body: string; ok?: boolean }
): { restore: () => void; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input);
    const req: CapturedRequest = { url, init: init ?? {} };
    captured.push(req);
    const { status, body } = responder(req);
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'text/event-stream' }
    });
  }) as typeof globalThis.fetch;

  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    captured
  };
}

suite('Chat adapter', () => {
  test('createConversation POSTs empty body to /beta/copilot/conversations and returns id', async () => {
    const stub = installFetchStub(() => ({
      status: 201,
      body: { id: 'conv-123', state: 'active', turnCount: 0 }
    }));
    try {
      const id = await createConversation('token-abc');
      assert.equal(id, 'conv-123');
      assert.equal(stub.captured.length, 1);
      const req = stub.captured[0];
      assert.equal(req.url, 'https://graph.microsoft.com/beta/copilot/conversations');
      assert.equal(req.init.method, 'POST');
      assert.equal(req.init.body, '{}');
      const headers = req.init.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer token-abc');
      assert.equal(headers['Content-Type'], 'application/json');
    } finally {
      stub.restore();
    }
  });

  test('sendMessage POSTs /chat endpoint with documented body and returns assistant reply text', async () => {
    const stub = installFetchStub(() => ({
      status: 200,
      body: {
        id: 'conv-123',
        state: 'active',
        turnCount: 1,
        messages: [
          {
            '@odata.type': '#microsoft.graph.copilotConversationResponseMessage',
            id: 'echo-1',
            text: 'hello copilot'
          },
          {
            '@odata.type': '#microsoft.graph.copilotConversationResponseMessage',
            id: 'reply-1',
            text: 'Hello! How can I help?'
          }
        ]
      }
    }));
    try {
      const reply = await sendMessage('token-abc', 'conv-123', 'hello copilot');
      assert.equal(reply, 'Hello! How can I help?');
      assert.equal(stub.captured.length, 1);
      const req = stub.captured[0];
      assert.equal(req.url, 'https://graph.microsoft.com/beta/copilot/conversations/conv-123/chat');
      assert.equal(req.init.method, 'POST');
      const body = JSON.parse(String(req.init.body));
      assert.deepEqual(body.message, { text: 'hello copilot' });
      assert.ok(body.locationHint && typeof body.locationHint.timeZone === 'string' && body.locationHint.timeZone.length > 0,
        'locationHint.timeZone must be a non-empty string');
    } finally {
      stub.restore();
    }
  });

  test('sendMessage includes additional context and contextual resources when provided', async () => {
    const stub = installFetchStub(() => ({
      status: 200,
      body: {
        messages: [
          { text: 'question' },
          { text: 'answer' }
        ]
      }
    }));
    try {
      const reply = await sendMessage('token-abc', 'conv-123', 'question', {
        additionalContext: [
          { description: 'Pinned note', text: 'Important context' }
        ],
        contextualResources: {
          files: [{ uri: 'https://contoso.sharepoint.com/sites/docs/a.docx' }]
        }
      });

      assert.equal(reply, 'answer');
      const body = JSON.parse(String(stub.captured[0].init.body));
      assert.deepEqual(body.additionalContext, [
        { description: 'Pinned note', text: 'Important context' }
      ]);
      assert.deepEqual(body.contextualResources.files, [
        { uri: 'https://contoso.sharepoint.com/sites/docs/a.docx' }
      ]);
    } finally {
      stub.restore();
    }
  });

  test('sendMessage skips echoed prompt when selecting assistant reply', async () => {
    const stub = installFetchStub(() => ({
      status: 200,
      body: {
        messages: [
          { text: 'prompt text' },
          { text: 'assistant answer' }
        ]
      }
    }));
    try {
      const reply = await sendMessage('t', 'c', 'prompt text');
      assert.equal(reply, 'assistant answer');
    } finally {
      stub.restore();
    }
  });

  test('sendMessage returns empty string when no assistant reply present', async () => {
    const stub = installFetchStub(() => ({
      status: 200,
      body: { messages: [] }
    }));
    try {
      const reply = await sendMessage('t', 'c', 'q');
      assert.equal(reply, '');
    } finally {
      stub.restore();
    }
  });

  test('sendMessage surfaces Graph error text on non-2xx response', async () => {
    const stub = installFetchStub(() => ({
      status: 404,
      body: { error: { code: 'UnknownError', message: '' } }
    }));
    try {
      await assert.rejects(
        () => sendMessage('t', 'c', 'q'),
        (err: Error) => /Graph API error 404/.test(err.message)
      );
    } finally {
      stub.restore();
    }
  });
});

suite('sendMessageStream', () => {
  test('POSTs to chatOverStream with Accept: text/event-stream and reports cumulative progress', async () => {
    const stub = installStreamingFetchStub(() => ({
      status: 200,
      body: sseBody([
        JSON.stringify({ messages: [{ text: 'question' }, { text: 'Hel' }] }),
        JSON.stringify({ messages: [{ text: 'question' }, { text: 'Hello!' }] })
      ])
    }));

    try {
      const progress: string[] = [];
      const reply = await sendMessageStream('token-abc', 'conv-123', 'question', {}, text => progress.push(text));

      assert.equal(reply, 'Hello!');
      assert.deepEqual(progress, ['Hel', 'Hello!']);

      const req = stub.captured[0];
      assert.equal(req.url, 'https://graph.microsoft.com/beta/copilot/conversations/conv-123/chatOverStream');
      assert.equal(req.init.method, 'POST');
      const headers = req.init.headers as Record<string, string>;
      assert.equal(headers.Accept, 'text/event-stream');
      const body = JSON.parse(String(req.init.body));
      assert.deepEqual(body.message, { text: 'question' });
    } finally {
      stub.restore();
    }
  });

  test('ignores malformed data: frames instead of failing the stream', async () => {
    const stub = installStreamingFetchStub(() => ({
      status: 200,
      body: 'data: not-json\n\n' + sseBody([JSON.stringify({ messages: [{ text: 'q' }, { text: 'ok' }] })])
    }));

    try {
      const reply = await sendMessageStream('t', 'c', 'q', {}, () => {});
      assert.equal(reply, 'ok');
    } finally {
      stub.restore();
    }
  });

  test('throws StreamAcceptedError (not a generic Error) when the accepted stream fails while reading', async () => {
    // Simulate a network drop after the service has already returned a 200
    // with a body — the failure happens while reading, not while connecting.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const brokenBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('simulated network drop'));
        }
      });
      return new Response(brokenBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof globalThis.fetch;

    try {
      await assert.rejects(
        () => sendMessageStream('t', 'c', 'q', {}, () => {}),
        (err: unknown) => err instanceof StreamAcceptedError
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

suite('sendMessageAuto', () => {
  test('uses the synchronous endpoint directly when streaming is disabled', async () => {
    const stub = installFetchStub(() => ({
      status: 200,
      body: { messages: [{ text: 'q' }, { text: 'sync answer' }] }
    }));

    try {
      const reply = await sendMessageAuto('t', 'c', 'q', {}, false, () => {});
      assert.equal(reply, 'sync answer');
      assert.equal(stub.captured[0].url, 'https://graph.microsoft.com/beta/copilot/conversations/c/chat');
    } finally {
      stub.restore();
    }
  });

  test('falls back to the synchronous endpoint once when the stream is never accepted', async () => {
    let call = 0;
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];

    globalThis.fetch = (async (input: unknown) => {
      const url = typeof input === 'string' ? input : String(input);
      urls.push(url);
      call += 1;
      if (url.endsWith('/chatOverStream')) {
        // Streaming endpoint unavailable for this tenant.
        return new Response(JSON.stringify({ error: { code: 'NotFound' } }), { status: 404 });
      }
      return new Response(
        JSON.stringify({ messages: [{ text: 'q' }, { text: 'fallback answer' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof globalThis.fetch;

    try {
      const reply = await sendMessageAuto('t', 'c', 'q', {}, true, () => {});
      assert.equal(reply, 'fallback answer');
      assert.equal(call, 2);
      assert.ok(urls[0].endsWith('/chatOverStream'));
      assert.ok(urls[1].endsWith('/chat'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not fall back — and does not resend the prompt — when the stream fails after being accepted', async () => {
    let call = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: unknown) => {
      const url = typeof input === 'string' ? input : String(input);
      call += 1;
      if (url.endsWith('/chatOverStream')) {
        const brokenBody = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error('simulated network drop'));
          }
        });
        return new Response(brokenBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      throw new Error('sync endpoint must not be called after an accepted stream fails');
    }) as typeof globalThis.fetch;

    try {
      await assert.rejects(() => sendMessageAuto('t', 'c', 'q', {}, true, () => {}));
      assert.equal(call, 1, 'only the streaming endpoint should have been called — no duplicate turn');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not fall back when the user cancels before the stream was ever accepted', async () => {
    let call = 0;
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      call += 1;
      // Simulate the request being aborted while still connecting, before
      // any response is received — fetch itself would reject with an
      // AbortError in this situation.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof globalThis.fetch;

    try {
      const pending = sendMessageAuto('t', 'c', 'q', {}, true, () => {}, controller.signal);
      controller.abort();
      await assert.rejects(
        () => pending,
        (err: unknown) => err instanceof Error && err.name === 'AbortError'
      );
      assert.equal(call, 1, 'the synchronous endpoint must not be called after user cancellation');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
