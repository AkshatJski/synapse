/**
 * lib/ndjson.ts
 *
 * Incremental reader for a newline-delimited JSON response body.
 *
 * The subtle part is boundaries: a `read()` from a network stream can split a
 * line anywhere — mid-object, mid-string, even mid-UTF-8 sequence. Decoding with
 * `{ stream: true }` and holding the unfinished tail until the next chunk is
 * what makes `/api/generate`'s progress events arrive intact.
 *
 * Kept out of the component so it can be tested offline (scripts/verify-ndjson.mts).
 */

export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        if (line) yield JSON.parse(line) as T;
      }
    }

    // A well-formed producer ends every line with "\n", but a truncated stream
    // may still have delivered one complete object without the terminator.
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as T;
  } finally {
    reader.releaseLock();
  }
}
