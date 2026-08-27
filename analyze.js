/**
 * POST /api/analyze
 * -----------------------------------------------------------
 * Accepts one image (multipart/form-data, field name "image"),
 * sends it to Claude's vision API with a structured prompt, and
 * returns JSON shaped like:
 *
 * {
 *   documentType: string,
 *   whatIsIt: string,
 *   importantInfo: string[],
 *   nextSteps: string[],
 *   checklist: string[]
 * }
 *
 * If ANTHROPIC_API_KEY is not set, this route responds with a
 * clear 501 error instead of ever inventing a fake result.
 * -----------------------------------------------------------
 */

const express = require("express");
const multer = require("multer");

const router = express.Router();

// Keep uploads in memory (never written to disk) — small MVP, fine for now.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const SYSTEM_PROMPT = `You are KaamBatao, an assistant that explains confusing documents, forms, bills, notices, and screenshots to everyday Indian users in simple, friendly Hinglish (a natural mix of Hindi and English, written in Roman/Latin script, the way Indians actually text each other).

Always respond with ONLY a JSON object (no markdown fences, no extra text) with exactly this shape:

{
  "documentType": "short label, e.g. 'Electricity Bill', 'Bank SMS', 'Government Notice'",
  "whatIsIt": "2-3 simple sentences explaining what this document is",
  "importantInfo": ["short bullet points of the key facts/numbers/dates found in it"],
  "nextSteps": ["short bullet points of what the user should do next"],
  "checklist": ["short, concrete, checkable action items derived from nextSteps"]
}

Keep every string short, clear, and jargon-free. If the image is unclear or not a document at all, still return this exact JSON shape, but say so honestly inside "whatIsIt" and keep the other arrays short/empty.`;

router.post("/", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Koi image nahi mili. Pehle ek photo upload karein." });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(501).json({
        message:
          "AI backend abhi configure nahi hai. Server par ANTHROPIC_API_KEY environment variable set karein (README dekhein).",
      });
    }

    const base64Image = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype || "image/jpeg";

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: "Is document/photo ko analyse karke upar diye gaye JSON format mein jawab dein.",
              },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errText);
      return res.status(502).json({
        message: "AI service se response nahi mila. Thodi der baad phir try karein.",
      });
    }

    const aiData = await aiResponse.json();
    const textBlock = (aiData.content || []).find((b) => b.type === "text");

    if (!textBlock) {
      return res.status(502).json({ message: "AI response samajh nahi aaya. Phir try karein." });
    }

    let parsed;
    try {
      const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse AI JSON:", textBlock.text);
      return res.status(502).json({ message: "AI response format galat tha. Phir try karein." });
    }

    return res.json(parsed);
  } catch (err) {
    console.error("Unexpected /api/analyze error:", err);
    return res.status(500).json({ message: "Kuch galat ho gaya. Phir try karein." });
  }
});

module.exports = router;
