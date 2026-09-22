// Minimal, spec-conformant Server-Sent Events parser over a fetch body.
// https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation

export interface SseMessage {
  /** The `event:` field, `message` when the server sent none. */
  event: string;
  /** Concatenated `data:` lines. */
  data: string;
  /** The `id:` field of this message, or the last one seen. */
  id: string | null;
  /** The `retry:` hint in ms, when present. */
  retry: number | null;
}

/** Yield one SseMessage per dispatched event from a byte stream. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let lastId: string | null = null;
  let retry: number | null = null;

  const dispatch = (): SseMessage | null => {
    if (data.length === 0) {
      event = "";
      return null;
    }
    const msg = { event: event || "message", data: data.join("\n"), id: lastId, retry };
    event = "";
    data = [];
    retry = null;
    return msg;
  };

  const handleLine = (line: string): SseMessage | null => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        event = value;
        break;
      case "data":
        data.push(value);
        break;
      case "id":
        if (!value.includes("\0")) lastId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) retry = Number(value);
        break;
    }
    return null;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.search(/\r\n|\r|\n/)) !== -1) {
        // A trailing CR may be the first half of a CRLF split across chunks.
        if (buffer[idx] === "\r" && idx === buffer.length - 1) break;
        const line = buffer.slice(0, idx);
        const sepLen = buffer.startsWith("\r\n", idx) ? 2 : 1;
        buffer = buffer.slice(idx + sepLen);
        const msg = handleLine(line);
        if (msg) yield msg;
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const msg = handleLine(buffer);
      if (msg) yield msg;
    }
    const tail = dispatch();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
