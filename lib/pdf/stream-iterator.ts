/**
 * pdf.js loops over streams with `for await`, which Safari 18 can't do: it
 * fails with "undefined is not a function (near '...t of e...')". pdf.js's
 * legacy build doesn't cover this, so add the missing loop support here.
 */
if (
  typeof ReadableStream !== "undefined" &&
  !(Symbol.asyncIterator in ReadableStream.prototype)
) {
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    async *value(this: ReadableStream<unknown>) {
      const reader = this.getReader();
      let finished = false;
      try {
        while (true) {
          // oxlint-disable-next-line no-await-in-loop -- chunks arrive in order
          const { done, value } = await reader.read();
          if (done) {
            finished = true;
            return;
          }
          yield value;
        }
      } finally {
        // Stopping the loop early cancels the stream, as browsers do.
        if (!finished) {
          // A stream that already failed can't be cancelled; keep its error.
          await reader.cancel().catch(() => null);
        }
        reader.releaseLock();
      }
    },
    writable: true,
  });
}
