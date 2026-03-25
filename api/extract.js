import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY;

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "Groq API key not configured" });
  }
  if (!OCR_SPACE_API_KEY) {
    return res.status(500).json({ error: "OCR.space API key not configured" });
  }

  try {
    const form = formidable({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024,
    });

    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve({ fields, files });
      });
    });

    const file = files.file?.[0] || files.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileBuffer = await fs.promises.readFile(file.filepath);
    const fileType = file.mimetype || "";
    const fileExt = file.originalFilename?.split(".").pop()?.toLowerCase() || "";

    console.log(`Processing file: ${file.originalFilename} (${fileType}, ${fileBuffer.length} bytes)`);

    let extractedText = "";

    // ---------- TEXT FILE ----------
    if (fileType.includes("text") || fileExt === "txt") {
      extractedText = fileBuffer.toString("utf-8");
      console.log("Text file loaded, length:", extractedText.length);
    }
    // ---------- PDF OR IMAGE ----------
    else if (
      fileType.includes("pdf") || fileExt === "pdf" ||
      fileType.includes("image") || ["jpg", "jpeg", "png"].includes(fileExt)
    ) {
      console.log("Processing file with OCR.space");
      extractedText = await ocrSpace(fileBuffer, fileExt, fileType);
      console.log("OCR.space extracted text length:", extractedText.length);
    }
    // ---------- UNSUPPORTED ----------
    else {
      return res.status(400).json({ error: "Unsupported file type. Please upload PDF, image, or text files." });
    }

    // Clean extracted text
    extractedText = extractedText.replace(/\s+/g, " ").trim();

    if (!extractedText) {
      return res.status(400).json({ error: "No text could be extracted from the uploaded file" });
    }

    console.log("Final extracted text (first 500 chars):", extractedText.slice(0, 500));

    // ---------- SEND TO GROQ ----------
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
${extractedText}`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4096,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: "You are a precise invoice data extractor. Always return only valid JSON with no extra text.",
          },
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
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

// ------------------------------------------------------------------
//  OCR.space API (works for both images and PDFs)
// ------------------------------------------------------------------
async function ocrSpace(fileBuffer, fileExt, mimeType) {
  const formData = new FormData();

  // For images, use base64 (more reliable in Node.js)
  if (["jpg", "jpeg", "png"].includes(fileExt)) {
    const base64 = fileBuffer.toString("base64");
    const mime = fileExt === "jpg" ? "image/jpeg" : `image/${fileExt}`;
    formData.append("base64Image", `data:${mime};base64,${base64}`);
    console.log("Sending image via base64");
  } else {
    // For PDFs, use file upload
    let contentType = mimeType;
    if (!contentType) {
      if (fileExt === "pdf") contentType = "application/pdf";
      else contentType = "application/octet-stream";
    }
    const blob = new Blob([fileBuffer], { type: contentType });
    formData.append("file", blob, `invoice.${fileExt}`);
    console.log("Sending PDF via file upload");
  }

  formData.append("apikey", process.env.OCR_SPACE_API_KEY);
  formData.append("language", "eng");
  formData.append("isOverlayRequired", "false");
  formData.append("OCREngine", "2");

  console.log("Calling OCR.space...");
  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: formData,
  });

  const result = await response.json();
  console.log("OCR.space status:", result.IsErroredOnProcessing ? "error" : "success");
  if (result.ErrorMessage) {
    console.error("OCR.space error details:", result.ErrorMessage);
  }

  if (result.IsErroredOnProcessing) {
    throw new Error(`OCR.space error: ${result.ErrorMessage?.[0] || "Unknown error"}`);
  }

  const parsedText = result.ParsedResults?.map(r => r.ParsedText).join("\n") || "";
  if (!parsedText) {
    console.warn("OCR.space returned empty text. Full response:", JSON.stringify(result, null, 2));
  }
  return parsedText;
}