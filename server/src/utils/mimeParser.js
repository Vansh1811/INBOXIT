const MAX_BODY_SIZE = 100 * 1024; // 100KB cap from PRD

const decodeBase64 = (data) => {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
};

const extractBody = (payload) => {
  let bodyHtml = "";
  let bodyText = "";

  const parse = (part) => {
    if (!part) return;
    if (part.mimeType === "text/html" && part.body?.data) {
      bodyHtml = decodeBase64(part.body.data);
    }
    if (part.mimeType === "text/plain" && part.body?.data) {
      bodyText = decodeBase64(part.body.data);
    }
    if (part.parts) part.parts.forEach(parse); // recurse for nested MIME
  };

  parse(payload);

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
