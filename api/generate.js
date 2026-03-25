const SYSTEM_INSTRUCTION = `You are an invoice generator. Output ONLY valid raw HTML starting with <!DOCTYPE html>. No markdown fences, no explanation, no preamble, no \`\`\`html wrapper. Just raw HTML.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, fileText } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "Groq API key not configured on server" });
  }

  let userMessage = prompt;
  if (fileText && fileText.trim()) {
    userMessage += `\n\nEXISTING INVOICE CONTENT (extracted from uploaded file):\n${fileText.trim()}`;
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 8192,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user",   content: userMessage },
        ],
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json();
      throw new Error(err?.error?.message || "Groq API error");
    }

    const data = await groqRes.json();
    let html = data?.choices?.[0]?.message?.content || "";

    // Strip any markdown fences Groq might add despite instructions
    html = html.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    if (!html.includes("<!DOCTYPE") && !html.includes("<html")) {
      throw new Error("Model returned an invalid response. Please try again.");
    }

    return res.status(200).json({ html });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}