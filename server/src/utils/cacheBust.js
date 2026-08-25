/**
 * SCAN-based cache invalidation.
 *
 * Replaces blocking O(N) `KEYS pattern` calls (which freeze the entire Redis
 * instance and are billed heavily on Upstash) with cursor-based SCAN +
 * batched deletes. Safe to call at request frequency.
 */

async function scanAndDelete(client, pattern, { batchSize = 200 } = {}) {
  let cursor = "0";
  let deleted = 0;

  do {
    const [nextCursor, keys] = await client.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      batchSize
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await client.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== "0");

  return deleted;
}

module.exports = { scanAndDelete };
