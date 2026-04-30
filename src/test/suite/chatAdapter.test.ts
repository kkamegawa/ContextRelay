import { strict as assert } from 'assert';
import { createConversation, sendMessage } from '../../adapters/chatAdapter';

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
