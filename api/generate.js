const fetch = require("node-fetch");

// pdf-parse and mammoth are too heavy for Vercel serverless
// We extract text client-side and send it as plain text instead

const SYSTEM_INSTRUCTION = `You are an invoice generator. Output ONLY valid raw HTML starting with <!DOCTYPE html>. No markdown fences, no explanation, no preamble, no \`\`\`html wrapper. Just raw HTML.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, fileText } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "Gemini API key not configured" });
  }

  let fullPrompt = prompt;
  if (fileText && fileText.trim()) {
    fullPrompt += `\n\nEXISTING INVOICE CONTENT (extracted from uploaded file):\n${fileText.trim()}`;
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
          generationConfig: { maxOutputTokens: 8192, temperature: 0.2 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err?.error?.message || "Gemini API error");
    }

    const data = await geminiRes.json();
    let html = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    html = html.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    if (!html.includes("<!DOCTYPE") && !html.includes("<html")) {
      throw new Error("Gemini returned invalid response. Please try again.");
    }

    return res.status(200).json({ html });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
