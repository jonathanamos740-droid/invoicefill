const SYSTEM_INSTRUCTION = `You are a professional invoice generator. Output ONLY valid raw HTML starting with <!DOCTYPE html>. No markdown fences, no explanation, no preamble. Just raw HTML that renders a beautiful print-ready invoice.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { fields } = req.body;
  if (!fields) return res.status(400).json({ error: "No fields provided" });

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const PDFSHIFT_API_KEY = process.env.PDFSHIFT_API_KEY;
  if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq API key not configured" });
  if (!PDFSHIFT_API_KEY) return res.status(500).json({ error: "PDFShift API key not configured" });

  const sym = fields.currencySymbol || "₦";

  const itemsText = (fields.items || []).map((it, i) =>
    `${i + 1}. ${it.description} | Qty: ${it.qty} | Unit Price: ${sym}${it.unitPrice} | Total: ${sym}${it.total}`
  ).join("\n");

  const prompt = `Generate a complete, professional, print-ready invoice as a single self-contained HTML page with embedded CSS. No external dependencies.

SELLER: ${fields.sellerName || "N/A"} | ${fields.sellerAddress || ""} | ${fields.sellerPhone || ""} | ${fields.sellerEmail || ""}
BUYER: ${fields.buyerName || "N/A"} | ${fields.buyerAddress || ""} | ${fields.buyerPhone || ""} | ${fields.buyerEmail || ""}
INVOICE #: ${fields.invoiceNumber || "N/A"} | DATE: ${fields.invoiceDate || ""} | DUE: ${fields.dueDate || ""} | CURRENCY: ${fields.currency || "NGN"}
DESCRIPTION: ${fields.description || ""}

LINE ITEMS:
${itemsText || "No items"}

SUBTOTAL: ${sym}${fields.subtotal || 0} | VAT ${fields.vatRate || 0}%: ${sym}${fields.vatAmount || 0} | DISCOUNT: ${sym}${fields.discount || 0} | TOTAL: ${sym}${fields.total || 0}
AMOUNT IN WORDS: ${fields.amountInWords || ""}

PAYMENT: ${fields.bankName || "N/A"} | Acct: ${fields.accountNumber || "N/A"} | Name: ${fields.accountName || "N/A"} | SWIFT: ${fields.swiftCode || "N/A"}
NOTES: ${fields.notes || "Payment due within 30 days. Thank you for your business."}

Design requirements:
- White background, clean professional layout
- Use #1e40af as the primary accent color
- Clear sections: header with logo area, seller/buyer info, items table, totals, payment details, notes
- Items table with proper columns: Description, Qty, Unit Price, Total
- Totals section showing subtotal, VAT, discount, and bold total
- Amount in words displayed clearly
- Payment details in a highlighted box
- Google Font (embed via @import in style tag)
- Fully inline CSS, no external stylesheets
- A4 paper size ready (max-width 210mm)
- Output ONLY raw HTML starting with <!DOCTYPE html>`;

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
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json();
      throw new Error(err?.error?.message || "Groq error");
    }

    const groqData = await groqRes.json();
    let html = groqData?.choices?.[0]?.message?.content || "";
    html = html.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    if (!html.includes("<!DOCTYPE") && !html.includes("<html")) {
      throw new Error("AI returned invalid HTML. Please try again.");
    }

    const pdfRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(`api:${PDFSHIFT_API_KEY}`).toString("base64"),
      },
      body: JSON.stringify({
        source: html,
        landscape: false,
        use_print_media: true,
        format: "A4",
        margin: "10mm",
      }),
    });

    if (!pdfRes.ok) {
      const err = await pdfRes.json();
      throw new Error(err?.message || "PDFShift error");
    }

    const pdfBuffer = await pdfRes.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

    return res.status(200).json({ pdf: pdfBase64 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}