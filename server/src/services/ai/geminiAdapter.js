/**
 * Gemini REST transport adapter (Phase 9).
 *
 * Provider-specific code is isolated HERE. The rest of the system depends
 * only on the AIClassifierService contract, never on this file's request/response
 * shapes. Uses the existing axios dependency — no provider SDK.
 *
 * Transport ONLY: no prompt construction, no validation, no policy.
 */
const axios = require("axios");

const DEFAULT_MODEL = process.env.AI_GEMINI_MODEL || "gemini-2.0-flash";
const GENERATE_ENDPOINT =
  (process.env.AI_GEMINI_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta/models") +
  "/:generateContent";

/**
 * @param {{ apiKey: string, model?: string, systemPrompt: string,
 *           userPrompt: string, timeoutMs?: number }} p
 * @returns {Promise<string>} raw model text output (unvalidated)
 */
async function callGemini({ apiKey, model = DEFAULT_MODEL, systemPrompt, userPrompt, timeoutMs = 8000 }) {
  const res = await axios.post(
    `${GENERATE_ENDPOINT.replace(":generateContent", "")}/${model}:generateContent`,
    {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 64,
        responseMimeType: "application/json",
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey, // header — never in URL/query strings/logs
      },
      timeout: timeoutMs,
    }
  );

  const parts = res.data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("");
  return text;
}

module.exports = { callGemini, DEFAULT_MODEL };
