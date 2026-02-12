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

// --- Shared helper: evaluate a JS expression against csvRows ---
const evalExpr = (expr) => {
  const fn = new Function("rows", `"use strict"; return (${expr});`);
  return fn(csvRows);
};

// --- Data endpoint (for client-side filtering) ---
app.get("/api/data", (req, res) => {
  res.json({ rows: csvRows, columns: csvColumns });
});

// --- Dashboard generation at startup ---
let dashboardRecipes = [];
let dashboardReady = false;

async function generateDashboard() {
  console.log("Generating dashboard...");
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: `You are a data visualization expert. You will be given a dataset summary. Your job is to return exactly 6 chart recipe specifications as a JSON array.

Each recipe tells the frontend which columns to use and how to aggregate them. The frontend will compute the actual data and handle filtering.

Each recipe must follow this exact format:
{
  "title": "Chart Title",
  "description": "One sentence explaining the key insight.",
  "type": "bar|pie|scatter|histogram",
  "xColumn": "column_name",
  "yColumn": "column_name_or_null",
  "aggregation": "count|average|sum|none"
}

Rules:
- type "bar" + aggregation "count": counts rows per unique value of xColumn
- type "bar" + aggregation "average": averages yColumn per unique value of xColumn
- type "bar" + aggregation "sum": sums yColumn per unique value of xColumn
- type "pie" + aggregation "count": proportions of xColumn values
- type "scatter" + aggregation "none": plots xColumn vs yColumn as points (both must be numeric)
- type "histogram" + aggregation "count": bins numeric xColumn values into ranges

Pick 6 charts that cover:
1. Distribution of a key categorical variable (pie)
2. Comparison of a numeric metric across categories (bar + average)
3. Relationship between two numeric variables (scatter)
4. Distribution of a numeric variable (histogram)
5. A surprising or noteworthy pattern you notice
6. One more of your choice

Use ONLY column names that exist in the dataset. Return ONLY a JSON array — no markdown fences, no explanation.`,
      messages: [{ role: "user", content: `Here is the dataset:\n\n${csvSummary}` }],
    });

    const rawText = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    let jsonText = rawText.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "").trim();
    jsonText = jsonText.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
    jsonText = jsonText.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

    dashboardRecipes = JSON.parse(jsonText);
    dashboardReady = true;
    console.log(`Dashboard ready (${dashboardRecipes.length} recipes)`);
  } catch (err) {
    console.error("Dashboard generation error:", err.message);
    dashboardReady = true;
  }
}

generateDashboard();

// --- Dashboard endpoint ---
app.get("/api/dashboard", (req, res) => {
  res.json({ recipes: dashboardRecipes, ready: dashboardReady });
});

// --- Chat endpoint ---
app.post("/api/chat", async (req, res) => {
  const { question, vizMode } = req.body;
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing question" });
  }

  const vizPrompt = vizMode ? `

**Visualization mode is ON.**

In addition to your text explanation, also return a chart specification as a JSON code block. The chart will be rendered with Plotly.js on the frontend.

Return the chart spec in this format:

\`\`\`json
{"chart": {
  "type": "bar|pie|scatter|histogram",
  "title": "Chart Title",
  "data": {
    "labels": "<js expression returning string array, evaluated against rows>",
    "values": "<js expression returning number array, evaluated against rows>"
  },
  "xLabel": "X Axis Label",
  "yLabel": "Y Axis Label"
}}
\`\`\`

For scatter charts, use "x" and "y" instead of "labels" and "values":
\`\`\`json
{"chart": {
  "type": "scatter",
  "title": "Chart Title",
  "data": {
    "x": "<js expression returning number array>",
    "y": "<js expression returning number array>"
  },
  "xLabel": "X Axis",
  "yLabel": "Y Axis"
}}
\`\`\`

Guidelines for chart selection:
- Comparing categories (e.g. by gender, by industry): use "bar"
- Showing proportions of a categorical variable: use "pie"
- Relationship between two numeric variables: use "scatter"
- Distribution of a numeric variable: use "histogram"

The JavaScript expressions in data fields will be evaluated with \`rows\` (the full dataset array). Write expressions that return arrays. Example:
- labels: \`[...new Set(rows.map(r => r.industry))]\`
- values: \`[...new Set(rows.map(r => r.industry))].map(ind => rows.filter(r => r.industry === ind).length)\`

Always provide a text explanation BEFORE the chart spec. Do NOT use a compute block when providing a chart block.
` : "";

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
${vizPrompt}
**If you can't answer something from this data, just say so.** Suggest what would be needed. Don't guess or stretch the data beyond what it can support.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
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
        const fn = new Function("rows", `"use strict"; return (${expression});`);
        const result = fn(csvRows);
        const beforeBlock = reply.substring(0, reply.indexOf("```json")).trim();
        reply = beforeBlock ? `${beforeBlock}\n\n${result}` : String(result);
      } catch (evalErr) {
        console.error("Compute error:", evalErr.message);
      }
    }

    // Check if Claude returned a chart spec block
    let chartData = null;
    const allJsonBlocks = [...reply.matchAll(/```json\s*\n([\s\S]*?)\n\s*```/g)];
    for (const block of allJsonBlocks) {
      let jsonText = block[1].trim();
      jsonText = jsonText.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
      jsonText = jsonText.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

      try {
        const parsed = JSON.parse(jsonText);
        if (!parsed.chart) continue;

        const chartSpec = parsed.chart;

        // Evaluate JS expressions in data fields
        for (const key of ["labels", "values", "x", "y"]) {
          if (typeof chartSpec.data[key] === "string") {
            chartSpec.data[key] = evalExpr(chartSpec.data[key]);
          }
        }

        chartData = chartSpec;
        reply = reply.replace(block[0], "").trim();
        break;
      } catch (chartErr) {
        console.error("Chart eval error:", chartErr.message);
        console.error("JSON text was:", jsonText.substring(0, 200));
      }
    }

    res.json({ reply, chart: chartData });
  } catch (err) {
    console.error("Claude API error:", err.message);
    res.status(500).json({ error: "Failed to get response from Claude" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
