export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { fileText } = req.body;
  if (!fileText) return res.status(400).json({ error: "No file text provided" });

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq API key not configured" });

  const prompt = `You are an invoice data extractor. Extract all invoice fields from the text below and return ONLY a valid JSON object. No explanation, no markdown, no code fences. Just raw JSON.

Extract these fields (use empty string "" if not found):
{
  "sellerName": "",
  "sellerAddress": "",
  "sellerPhone": "",
  "sellerEmail": "",
  "buyerName": "",
  "buyerAddress": "",
  "buyerPhone": "",
  "buyerEmail": "",
  "invoiceNumber": "",
  "invoiceDate": "",
  "dueDate": "",
  "currency": "",
  "currencySymbol": "",
  "items": [
    { "description": "", "qty": 1, "unitPrice": 0, "total": 0 }
  ],
  "subtotal": 0,
  "vatRate": 0,
  "vatAmount": 0,
  "discount": 0,
  "total": 0,
  "amountInWords": "",
  "bankName": "",
  "accountNumber": "",
  "accountName": "",
  "swiftCode": "",
  "notes": "",
  "description": ""
}

For currency: detect from symbols (₦=NGN, $=USD, £=GBP, €=EUR, ₵=GHS, KSh=KES, R=ZAR).
For dates: keep the original format found in the document.
For items: extract every line item you can find.
For description: extract any overall invoice description or purpose if present.

INVOICE TEXT:
${fileText}`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4096,
        temperature: 0.1,
        messages: [
          { role: "system", content: "You are a precise invoice data extractor. Always return only valid JSON with no extra text." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json();
      throw new Error(err?.error?.message || "Groq API error");
    }

    const data = await groqRes.json();
    let raw = data?.choices?.[0]?.message?.content || "";
    raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    const fields = JSON.parse(raw);
    return res.status(200).json({ fields });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
