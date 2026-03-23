const MAX_BODY_SIZE = 100 * 1024; // 100KB cap from PRD

const decodeBase64 = (data) => {
  if (!data || typeof data !== "string") return "";
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  } catch {
    return "";
  }
};

const isLikelyAttachmentPart = (part = {}) => {
  const hasFilename = Boolean(part.filename);
  const disposition = (part.headers || []).find(
    (h) => h?.name?.toLowerCase() === "content-disposition"
  )?.value;

  return hasFilename || /attachment/i.test(disposition || "");
};

const extractBody = (payload) => {
  const htmlCandidates = [];
  const textCandidates = [];

  const parse = (part) => {
    if (!part) return;

    // Skip attachment-like parts so they don't override the visible message body
    if (isLikelyAttachmentPart(part)) {
      if (part.parts) part.parts.forEach(parse);
      return;
    }

    const decoded = decodeBase64(part.body?.data);
    const trimmed = decoded.trim();

    if (trimmed) {
      if (part.mimeType === "text/html") {
        htmlCandidates.push(decoded);
      }

      if (part.mimeType === "text/plain") {
        textCandidates.push(decoded);
      }
    }

    if (part.parts) part.parts.forEach(parse); // recurse for nested MIME
  };

  parse(payload);

  const pickBest = (candidates) => {
    if (!candidates.length) return "";
    return candidates.sort((a, b) => b.trim().length - a.trim().length)[0];
  };

  const bodyHtml = pickBest(htmlCandidates);
  const bodyText = pickBest(textCandidates);

  return {
    bodyHtml: bodyHtml.slice(0, MAX_BODY_SIZE),
    bodyText: bodyText.slice(0, MAX_BODY_SIZE),
  };
};

const extractHeaders = (headers = []) => {
  const get = (name) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
  return {
    from: get("from"),
    to: get("to"),
    subject: get("subject"),
    date: get("date"),
  };
};

module.exports = { extractBody, extractHeaders };
