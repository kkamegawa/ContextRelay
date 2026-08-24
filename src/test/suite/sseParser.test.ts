import { strict as assert } from 'assert';
import { extractLatestReplyText, SseFrameParser } from '../../adapters/sseParser';

suite('SseFrameParser', () => {
  test('parses a single complete frame delivered in one push', () => {
    const parser = new SseFrameParser();
    const events = parser.push('data: {"a":1}\n\n');
    assert.equal(events.length, 1);
    assert.equal(events[0].data, '{"a":1}');
  });

  test('buffers a partial frame until the closing blank line arrives', () => {
    const parser = new SseFrameParser();
    const first = parser.push('data: {"a"');
    assert.deepEqual(first, []);

    const second = parser.push(':1}\n\n');
    assert.equal(second.length, 1);
    assert.equal(second[0].data, '{"a":1}');
  });

  test('handles CRLF frame separators', () => {
    const parser = new SseFrameParser();
    const events = parser.push('data: {"a":1}\r\n\r\n');
    assert.equal(events.length, 1);
    assert.equal(events[0].data, '{"a":1}');
  });

  test('handles a CRLF frame separator split across two push calls', () => {
    // A network chunk boundary can split "\r\n\r\n" mid-sequence, e.g. after
    // the first \r\n but before the second. Normalizing each chunk in
    // isolation would leave a stray \r in the buffer and never find the \n\n
    // boundary; normalizing must happen on the concatenated buffer instead.
    const parser = new SseFrameParser();
    const first = parser.push('data: {"a":1}\r\n\r');
    assert.deepEqual(first, []);

    const second = parser.push('\n');
    assert.equal(second.length, 1);
    assert.equal(second[0].data, '{"a":1}');
  });

  test('handles a lone \\r left over from a chunk boundary split, followed by more frames', () => {
    const parser = new SseFrameParser();
    parser.push('data: first\r\n\r');
    const events = parser.push('\ndata: second\n\n');
    assert.deepEqual(events.map(e => e.data), ['first', 'second']);
  });

  test('returns multiple events from a single push in order', () => {
    const parser = new SseFrameParser();
    const events = parser.push('data: {"a":1}\n\ndata: {"a":2}\n\ndata: {"a":3}\n\n');
    assert.deepEqual(events.map(e => e.data), ['{"a":1}', '{"a":2}', '{"a":3}']);
  });

  test('joins multiple data: lines within one frame with newlines', () => {
    const parser = new SseFrameParser();
    const events = parser.push('data: line1\ndata: line2\n\n');
    assert.equal(events.length, 1);
    assert.equal(events[0].data, 'line1\nline2');
  });

  test('captures the event: field alongside data', () => {
    const parser = new SseFrameParser();
    const events = parser.push('event: message\ndata: hello\n\n');
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'message');
    assert.equal(events[0].data, 'hello');
  });

  test('ignores comment and id: lines', () => {
    const parser = new SseFrameParser();
    const events = parser.push(': heartbeat\nid: 42\ndata: hello\n\n');
    assert.equal(events.length, 1);
    assert.equal(events[0].data, 'hello');
  });

  test('drops a frame with no data: lines', () => {
    const parser = new SseFrameParser();
    const events = parser.push('id: 42\n\ndata: hello\n\n');
    assert.deepEqual(events.map(e => e.data), ['hello']);
  });

  test('flush() returns a trailing partial frame with data', () => {
    const parser = new SseFrameParser();
    parser.push('data: partial');
    const flushed = parser.flush();
    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].data, 'partial');
  });

  test('flush() on an empty or whitespace-only buffer returns no events', () => {
    const parser = new SseFrameParser();
    assert.deepEqual(parser.flush(), []);

    parser.push('   \n');
    assert.deepEqual(parser.flush(), []);
  });

  test('flush() clears the buffer so a later push starts fresh', () => {
    const parser = new SseFrameParser();
    parser.push('data: partial');
    parser.flush();
    const events = parser.push('data: fresh\n\n');
    assert.equal(events.length, 1);
    assert.equal(events[0].data, 'fresh');
  });
});

suite('extractLatestReplyText', () => {
  test('returns the last message that is not the echoed prompt', () => {
    const json = {
      messages: [
        { text: 'my prompt' },
        { text: 'partial reply so far' }
      ]
    };
    assert.equal(extractLatestReplyText(json, 'my prompt'), 'partial reply so far');
  });

  test('returns undefined when messages is missing or not an array', () => {
    assert.equal(extractLatestReplyText({}, 'prompt'), undefined);
    assert.equal(extractLatestReplyText({ messages: 'nope' }, 'prompt'), undefined);
    assert.equal(extractLatestReplyText(null, 'prompt'), undefined);
    assert.equal(extractLatestReplyText('a string', 'prompt'), undefined);
  });

  test('returns undefined when every message equals the prompt or is empty', () => {
    const json = { messages: [{ text: 'prompt' }, { text: '' }, { text: '   ' }] };
    assert.equal(extractLatestReplyText(json, 'prompt'), undefined);
  });

  test('skips trailing empty messages to find the latest non-empty reply', () => {
    const json = {
      messages: [
        { text: 'prompt' },
        { text: 'first partial' },
        { text: '' }
      ]
    };
    assert.equal(extractLatestReplyText(json, 'prompt'), 'first partial');
  });
});
