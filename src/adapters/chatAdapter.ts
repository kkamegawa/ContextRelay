import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatConversation {
  id: string;
  messages: ChatMessage[];
}

interface CreateConversationResponse {
  id?: string;
}

interface MessageResponse {
  value?: { content?: string }[];
  content?: string;
}

export async function createConversation(token: string): Promise<string> {
  const url = `${GRAPH_BASE}/beta/copilot/conversations`;
  const body = JSON.stringify({});

  const response = await graphFetchWithRetry(url, token, { method: 'POST', body });
  const data = await handleGraphResponse(response) as CreateConversationResponse;

  if (!data?.id) {
    throw new Error('Failed to create Copilot conversation: no ID returned.');
  }
  return data.id;
}

export async function sendMessage(
  token: string,
  conversationId: string,
  message: string
): Promise<string> {
  const url = `${GRAPH_BASE}/beta/copilot/conversations/${conversationId}/messages`;
  const body = JSON.stringify({ content: message });

  const response = await graphFetchWithRetry(url, token, { method: 'POST', body });
  const data = await handleGraphResponse(response) as MessageResponse;

  const content = (data as { content?: string })?.content
    ?? data?.value?.[0]?.content
    ?? '';
  return content;
}

/**
 * Convenience wrapper that creates a fresh Microsoft 365 Copilot conversation
 * and sends a single prompt, returning the assistant reply text.
 */
export async function askCopilot(token: string, prompt: string): Promise<string> {
  const conversationId = await createConversation(token);
  const reply = await sendMessage(token, conversationId, prompt);
  if (!reply.trim()) {
    throw new Error('Microsoft 365 Copilot returned an empty response.');
  }
  return reply;
}
