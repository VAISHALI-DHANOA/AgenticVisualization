require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");
const Anthropic = require("@anthropic-ai/sdk").default;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- CSV data loaded at startup ---
let csvRows = [];
let csvColumns = [];
let csvSummary = "";

function loadCsv() {
  const csvPath = path.join(__dirname, "public", "ai_job_displacement_survey.csv");
  const text = fs.readFileSync(csvPath, "utf-8");
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  csvRows = parsed.data;
  csvColumns = parsed.meta.fields || [];

  // Build a summary for Claude: column info + sample rows + basic stats
  const sampleRows = csvRows.slice(0, 5);
  const numericCols = [];
  const categoricalCols = [];

  csvColumns.forEach((col) => {
    const values = csvRows.map((r) => r[col]).filter((v) => v !== "" && v != null);
    const nums = values.map(Number).filter((n) => !Number.isNaN(n));
    if (nums.length === values.length && values.length > 0) {
      numericCols.push(col);
    } else {
      categoricalCols.push(col);
    }
  });

  const stats = numericCols.map((col) => {
    const vals = csvRows.map((r) => Number(r[col])).filter((n) => !Number.isNaN(n));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    return `  ${col}: min=${min}, max=${max}, avg=${avg}`;
  });

  const catInfo = categoricalCols.map((col) => {
    const unique = [...new Set(csvRows.map((r) => r[col]).filter(Boolean))];
    const preview = unique.slice(0, 8).join(", ");
    return `  ${col}: ${unique.length} unique values (${preview}${unique.length > 8 ? ", ..." : ""})`;
  });

  csvSummary = [
    `Dataset: ${csvRows.length} rows, ${csvColumns.length} columns.`,
    "",
    "Numeric columns (with stats):",
    ...stats,
    "",
    "Categorical columns (with unique values):",
    ...catInfo,
    "",
    "Sample rows (first 5):",
    JSON.stringify(sampleRows, null, 2),
  ].join("\n");

  console.log(`Loaded CSV: ${csvRows.length} rows, ${csvColumns.length} columns`);
}

loadCsv();

// --- Anthropic client ---
const anthropic = new Anthropic();

// --- Chat endpoint ---
app.post("/api/chat", async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing question" });
  }

const systemPrompt = `You are a senior data expert who's spent months with this survey dataset. You know it inside and out. Talk about it the way you'd talk to a colleague over coffee — naturally, conversationally, like someone who genuinely finds this stuff interesting.

**How you communicate:**

- Lead with the "so what." Don't just state a number — tell people why it's interesting, surprising, or worth knowing.
- Talk like a person. Say things like "What stands out here is..." or "The short answer is..." or "Interestingly enough..." — not "The data indicates that..."
- Match the energy of the question. A simple question gets a simple answer. A complex one gets a thoughtful, layered response. Don't over-explain what doesn't need it.
- Never dump a wall of stats. If someone asks a broad question, pick the 2-3 most compelling things and weave them into a natural response. You can always offer to go deeper.
- Use numbers to support a point, not as the point itself. "About two-thirds of respondents..." reads better than "66.7% of respondents..."
- If something in the data is genuinely surprising or counterintuitive, say so. If it's pretty much what you'd expect, say that too.

**Your knowledge base:**

${csvSummary}

**When you need to compute something:**

If a question requires calculation over the full dataset, include a JSON code block with a JavaScript expression that will be evaluated against \`rows\` (an array of row objects). The expression must return the final answer as a string or number. Use only basic JS (map, filter, reduce, sort, Set, Math, Object).

\`\`\`json
{"compute": "<javascript expression>"}
\`\`\`

When you do this, frame it naturally — set up what you're looking into before the code block, and after the result comes back, the reader should understand what it means in context, not just see a number.

**If you can't answer something from this data, just say so.** Suggest what would be needed. Don't guess or stretch the data beyond what it can support.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: question }],
    });

    let reply = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Check if Claude returned a compute block
    const computeMatch = reply.match(/```json\s*\n?\{[\s\S]*?"compute"\s*:\s*"([\s\S]*?)"\s*\}\s*\n?```/);
    if (computeMatch) {
      try {
        const jsonBlock = reply.match(/```json\s*\n?([\s\S]*?)\n?```/)[1];
        const parsed = JSON.parse(jsonBlock);
        const expression = parsed.compute;
        // Execute the expression against the full dataset
        const fn = new Function("rows", `"use strict"; return (${expression});`);
        const result = fn(csvRows);
        // Replace the code block with the computed result in the reply
        const beforeBlock = reply.substring(0, reply.indexOf("```json")).trim();
        reply = beforeBlock ? `${beforeBlock}\n\n${result}` : String(result);
      } catch (evalErr) {
        console.error("Compute error:", evalErr.message);
        // Fall back to the raw reply from Claude
      }
    }

    res.json({ reply });
  } catch (err) {
    console.error("Claude API error:", err.message);
    res.status(500).json({ error: "Failed to get response from Claude" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
