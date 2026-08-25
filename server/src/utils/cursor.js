/**
 * Opaque pagination cursor codec.
 *
 * Canonical ordering everywhere: receivedAt DESC, _id DESC.
 * A cursor encodes the LAST item of the previous page so the next query
 * seeks strictly past it:
 *
 *   $or: [
 *     { receivedAt: { $lt: r } },
 *     { receivedAt: { $eq: r }, _id: { $lt: i } }   // exact-tie handling
 *   ]
 *
 * Encoding is plain base64url JSON — opaque to casual inspection, trivially
 * decodable by design. Type validation happens on decode; a malformed cursor
 * yields null which callers must reject with HTTP 400. No cryptographic
 * signing: cursors grant access to nothing the JWT-holder cannot already query.
 */

const CURSOR_FIELDS_OK = /^[0-9a-f]{24}$/i;

function encodeCursor(receivedAt, id) {
  const payload = {
    r: receivedAt instanceof Date ? receivedAt.toISOString() : String(receivedAt),
    i: String(id),
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * @returns {{ receivedAt: Date, id: string } | null} null for ANY malformed input
 */
function decodeCursor(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;

  let json;
  try {
    json = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!json || typeof json !== "object") return null;

  const { r, i } = json;
  if (typeof r !== "string" || typeof i !== "string") return null;
  if (!CURSOR_FIELDS_OK.test(i)) return null;

  const ts = Date.parse(r);
  if (!Number.isFinite(ts)) return null;

  return { receivedAt: new Date(ts), id: i };
}

/**
 * Build the Mongo keyset boundary clause for the canonical sort.
 * @returns {object} empty object when cursor is null (first page)
 */
function keysetBoundary(cursor) {
  if (!cursor) return {};
  return {
    $or: [
      { receivedAt: { $lt: cursor.receivedAt } },
      { receivedAt: { $eq: cursor.receivedAt }, _id: { $lt: cursor.id } },
    ],
  };
}

module.exports = { encodeCursor, decodeCursor, keysetBoundary };
