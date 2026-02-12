// --- DOM Elements ---
const elements = {
  messages: document.getElementById("messages"),
  userInput: document.getElementById("userInput"),
  sendBtn: document.getElementById("sendBtn"),
  vizMode: document.getElementById("vizMode"),
  dashboardPanel: document.getElementById("dashboardPanel"),
  dashboardGrid: document.getElementById("dashboardGrid"),
  dashboardLoading: document.getElementById("dashboardLoading"),
  chatPanel: document.getElementById("chat"),
  filterBar: document.getElementById("filterBar"),
  filterChips: document.getElementById("filterChips"),
  clearFilters: document.getElementById("clearFilters"),
};

// --- Tab switching ---
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    if (target === "dashboard") {
      elements.dashboardPanel.classList.remove("hidden");
      elements.chatPanel.classList.add("hidden");
    } else {
      elements.chatPanel.classList.remove("hidden");
      elements.dashboardPanel.classList.add("hidden");
    }
  });
});

// --- Data & Filter State ---
let allRows = [];
let dashboardRecipes = [];
let activeFilters = {};
// Per-chart category selections: cardIndex -> Set of selected category labels
let cardCategorySelections = {};
const DEFAULT_MAX_CATEGORIES = 4;

// Polished color palette
const COLORS = [
  "#4C78A8", "#F58518", "#E45756", "#72B7B2",
  "#54A24B", "#EECA3B", "#B279A2", "#FF9DA6",
  "#9D755D", "#BAB0AC",
];
const OTHER_COLOR = "#D0D5E0";

function getFilteredRows() {
  return allRows.filter((row) => {
    for (const [col, val] of Object.entries(activeFilters)) {
      if (row[col] !== val) return false;
    }
    return true;
  });
}

// --- Get all unique categories for a column, sorted by count descending ---
function getAllCategories(column, rows) {
  const counts = {};
  for (const row of rows) {
    const key = row[column] || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);
}

// --- Aggregation: compute chart data from recipe + rows, with category limiting ---
function computeChartData(recipe, rows, selectedCategories) {
  const { type, xColumn, yColumn, aggregation } = recipe;

  if (type === "scatter") {
    return { x: rows.map((r) => Number(r[xColumn])), y: rows.map((r) => Number(r[yColumn])) };
  }

  if (type === "histogram") {
    return { values: rows.map((r) => Number(r[xColumn])) };
  }

  // bar or pie: group by xColumn
  const groups = {};
  for (const row of rows) {
    const key = row[xColumn] || "Unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  // Determine which categories to show vs collapse into "Other"
  const selected = selectedCategories || Object.keys(groups);
  const shownLabels = [];
  const shownValues = [];
  let otherValue = 0;
  let hasOther = false;

  // Sort all keys by count descending for consistent ordering
  const allKeys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);

  for (const key of allKeys) {
    const groupRows = groups[key];
    let val;
    if (aggregation === "count") {
      val = groupRows.length;
    } else if (aggregation === "average") {
      const nums = groupRows.map((r) => Number(r[yColumn])).filter((n) => !isNaN(n));
      val = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0;
    } else if (aggregation === "sum") {
      val = groupRows.map((r) => Number(r[yColumn])).filter((n) => !isNaN(n)).reduce((a, b) => a + b, 0);
    }

    if (selected.includes(key)) {
      shownLabels.push(key);
      shownValues.push(val);
    } else {
      // For "Other", sum counts/sums but average doesn't aggregate well — skip "Other" for averages
      if (aggregation === "average") continue;
      otherValue += val;
      hasOther = true;
    }
  }

  if (hasOther && otherValue > 0) {
    shownLabels.push("Other");
    shownValues.push(otherValue);
  }

  return { labels: shownLabels, values: shownValues };
}

// --- Plotly styling ---
const PLOTLY_LAYOUT_BASE = {
  margin: { t: 8, b: 50, l: 55, r: 16 },
  paper_bgcolor: "transparent",
  plot_bgcolor: "#fafbfe",
  font: { family: "Inter, system-ui, sans-serif", size: 11, color: "#5b6475" },
  height: 280,
  xaxis: { gridcolor: "#eef0f6", zerolinecolor: "#e1e5f1" },
  yaxis: { gridcolor: "#eef0f6", zerolinecolor: "#e1e5f1" },
};

const PLOTLY_CONFIG = {
  displayModeBar: false,
  responsive: true,
};

function getBarColors(labels, xColumn) {
  return labels.map((label, i) => {
    if (label === "Other") return OTHER_COLOR;
    if (activeFilters[xColumn] && activeFilters[xColumn] !== label) return "#e0e3ec";
    return COLORS[i % COLORS.length];
  });
}

function renderPlotlyChart(container, recipe, rows, selectedCategories) {
  const data = computeChartData(recipe, rows, selectedCategories);
  let traces, layout;

  if (recipe.type === "bar") {
    traces = [{
      type: "bar",
      x: data.labels,
      y: data.values,
      marker: {
        color: getBarColors(data.labels, recipe.xColumn),
        line: { width: 0 },
      },
      hovertemplate: "<b>%{x}</b><br>%{y}<extra></extra>",
    }];
    const yTitle = recipe.aggregation === "count" ? "Count"
      : recipe.aggregation === "average" ? `Avg ${recipe.yColumn}`
      : recipe.yColumn;
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, tickangle: data.labels.some((l) => l.length > 10) ? -30 : 0 },
      yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, title: { text: yTitle, standoff: 10 } },
    };
  } else if (recipe.type === "pie") {
    const pieColors = data.labels.map((label, i) =>
      label === "Other" ? OTHER_COLOR : COLORS[i % COLORS.length]
    );
    traces = [{
      type: "pie",
      labels: data.labels,
      values: data.values,
      marker: { colors: pieColors, line: { color: "#fff", width: 2 } },
      textinfo: "label+percent",
      textposition: "inside",
      insidetextorientation: "horizontal",
      hovertemplate: "<b>%{label}</b><br>%{value} (%{percent})<extra></extra>",
      hole: 0.35,
    }];
    layout = { ...PLOTLY_LAYOUT_BASE, margin: { t: 8, b: 8, l: 8, r: 8 }, showlegend: false };
  } else if (recipe.type === "scatter") {
    traces = [{
      type: "scatter",
      mode: "markers",
      x: data.x,
      y: data.y,
      marker: { color: COLORS[0], size: 5, opacity: 0.5, line: { width: 0 } },
      hovertemplate: `<b>${recipe.xColumn}</b>: %{x}<br><b>${recipe.yColumn}</b>: %{y}<extra></extra>`,
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: { text: recipe.xColumn, standoff: 8 } },
      yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, title: { text: recipe.yColumn, standoff: 10 } },
    };
  } else if (recipe.type === "histogram") {
    traces = [{
      type: "histogram",
      x: data.values,
      marker: { color: COLORS[0], line: { color: "#fff", width: 1 } },
      hovertemplate: "Range: %{x}<br>Count: %{y}<extra></extra>",
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: { text: recipe.xColumn, standoff: 8 } },
      yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, title: { text: "Count", standoff: 10 } },
      bargap: 0.05,
    };
  }

  Plotly.newPlot(container, traces, layout, PLOTLY_CONFIG);

  // Cross-filter click handler for bar and pie
  if (recipe.type === "bar" || recipe.type === "pie") {
    container.on("plotly_click", (eventData) => {
      const clickedLabel = eventData.points[0].label || eventData.points[0].x;
      if (clickedLabel === "Other") return; // Don't filter on "Other"
      const col = recipe.xColumn;
      if (activeFilters[col] === clickedLabel) {
        delete activeFilters[col];
      } else {
        activeFilters[col] = clickedLabel;
      }
      renderAllDashboardCharts();
      updateFilterBar();
    });
  }
}

// --- Chat chart rendering ---
function renderChatChart(container, spec) {
  let traces, layout;

  if (spec.type === "scatter") {
    traces = [{
      type: "scatter", mode: "markers",
      x: spec.data.x, y: spec.data.y,
      marker: { color: COLORS[0], size: 5, opacity: 0.5 },
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: spec.xLabel || "" },
      yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, title: spec.yLabel || "" },
    };
  } else if (spec.type === "histogram") {
    traces = [{
      type: "histogram",
      x: spec.data.values || spec.data.labels,
      marker: { color: COLORS[0], line: { color: "#fff", width: 1 } },
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: spec.xLabel || "" },
      yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, title: spec.yLabel || "Count" },
    };
  } else if (spec.type === "pie") {
    traces = [{
      type: "pie",
      labels: spec.data.labels, values: spec.data.values,
      marker: { colors: (spec.data.labels || []).map((_, i) => COLORS[i % COLORS.length]), line: { color: "#fff", width: 2 } },
      hole: 0.35, textinfo: "label+percent",
    }];
    layout = { ...PLOTLY_LAYOUT_BASE, margin: { t: 8, b: 8, l: 8, r: 8 }, showlegend: false };
  } else {
    traces = [{
      type: "bar",
      x: spec.data.labels, y: spec.data.values,
      marker: { color: COLORS[0] },
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { ...PLOTLY_LAYOUT_BASE.xaxis, title: spec.xLabel || "" },
      yaxis: { ...PLOTLY_LAYOUT_BASE.yaxis, title: spec.yLabel || "" },
    };
  }

  if (spec.title) {
    layout.title = { text: spec.title, font: { size: 13 } };
  }

  Plotly.newPlot(container, traces, layout, PLOTLY_CONFIG);
}

// --- Dashboard rendering ---
function renderSingleCard(cardIndex) {
  const card = elements.dashboardGrid.querySelectorAll(".dashboard-card")[cardIndex];
  const recipe = dashboardRecipes[cardIndex];
  if (!card || !recipe) return;
  const plotDiv = card.querySelector(".plot-div");
  const rows = getFilteredRows();
  const selected = cardCategorySelections[cardIndex] || null;
  renderPlotlyChart(plotDiv, recipe, rows, selected);
}

function renderAllDashboardCharts() {
  const rows = getFilteredRows();
  const cards = elements.dashboardGrid.querySelectorAll(".dashboard-card");

  cards.forEach((card, i) => {
    const recipe = dashboardRecipes[i];
    if (!recipe) return;
    const plotDiv = card.querySelector(".plot-div");
    const selected = cardCategorySelections[i] || null;
    renderPlotlyChart(plotDiv, recipe, rows, selected);
  });
}

function buildCategorySelector(cardIndex, recipe) {
  // Only for bar and pie charts with categorical grouping
  if (recipe.type === "scatter" || recipe.type === "histogram") return null;

  const rows = getFilteredRows();
  const allCats = getAllCategories(recipe.xColumn, rows);
  if (allCats.length <= DEFAULT_MAX_CATEGORIES) return null; // No need for selector

  // Default: top 4 by count
  if (!cardCategorySelections[cardIndex]) {
    cardCategorySelections[cardIndex] = allCats.slice(0, DEFAULT_MAX_CATEGORIES);
  }
  const selected = cardCategorySelections[cardIndex];

  const wrapper = document.createElement("div");
  wrapper.className = "category-selector";

  const pills = document.createElement("div");
  pills.className = "category-pills";

  for (const cat of allCats) {
    const pill = document.createElement("button");
    pill.className = "category-pill" + (selected.includes(cat) ? " active" : "");
    pill.textContent = cat;
    pill.addEventListener("click", () => {
      const sel = cardCategorySelections[cardIndex];
      if (sel.includes(cat)) {
        // Don't allow deselecting all
        if (sel.length <= 1) return;
        cardCategorySelections[cardIndex] = sel.filter((c) => c !== cat);
      } else {
        cardCategorySelections[cardIndex] = [...sel, cat];
      }
      // Re-render just this card's selector and chart
      rebuildCardSelector(cardIndex);
      renderSingleCard(cardIndex);
    });
    pills.appendChild(pill);
  }

  // "All" toggle
  const allBtn = document.createElement("button");
  allBtn.className = "category-pill category-pill-all" + (selected.length === allCats.length ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    if (cardCategorySelections[cardIndex].length === allCats.length) {
      cardCategorySelections[cardIndex] = allCats.slice(0, DEFAULT_MAX_CATEGORIES);
    } else {
      cardCategorySelections[cardIndex] = [...allCats];
    }
    rebuildCardSelector(cardIndex);
    renderSingleCard(cardIndex);
  });
  pills.insertBefore(allBtn, pills.firstChild);

  wrapper.appendChild(pills);
  return wrapper;
}

function rebuildCardSelector(cardIndex) {
  const card = elements.dashboardGrid.querySelectorAll(".dashboard-card")[cardIndex];
  if (!card) return;
  const existing = card.querySelector(".category-selector");
  if (existing) existing.remove();
  const recipe = dashboardRecipes[cardIndex];
  const selector = buildCategorySelector(cardIndex, recipe);
  if (selector) {
    const plotDiv = card.querySelector(".plot-div");
    card.insertBefore(selector, plotDiv);
  }
}

function buildDashboardCards() {
  elements.dashboardGrid.innerHTML = "";
  cardCategorySelections = {};

  dashboardRecipes.forEach((recipe, i) => {
    const card = document.createElement("div");
    card.className = "dashboard-card";

    const title = document.createElement("h3");
    title.textContent = recipe.title || "Chart";
    card.appendChild(title);

    if (recipe.description) {
      const desc = document.createElement("p");
      desc.textContent = recipe.description;
      card.appendChild(desc);
    }

    const selector = buildCategorySelector(i, recipe);
    if (selector) card.appendChild(selector);

    const plotDiv = document.createElement("div");
    plotDiv.className = "plot-div";
    card.appendChild(plotDiv);
    elements.dashboardGrid.appendChild(card);
  });

  renderAllDashboardCharts();
}

// --- Filter bar ---
function updateFilterBar() {
  const keys = Object.keys(activeFilters);
  if (keys.length === 0) {
    elements.filterBar.classList.add("hidden");
    return;
  }

  elements.filterBar.classList.remove("hidden");
  elements.filterChips.innerHTML = "";

  for (const [col, val] of Object.entries(activeFilters)) {
    const chip = document.createElement("span");
    chip.className = "filter-chip";
    chip.innerHTML = `${col}: <strong>${val}</strong> <span class="filter-chip-x" data-col="${col}">&times;</span>`;
    elements.filterChips.appendChild(chip);
  }

  elements.filterChips.querySelectorAll(".filter-chip-x").forEach((x) => {
    x.addEventListener("click", () => {
      delete activeFilters[x.dataset.col];
      renderAllDashboardCharts();
      updateFilterBar();
    });
  });
}

elements.clearFilters.addEventListener("click", () => {
  activeFilters = {};
  renderAllDashboardCharts();
  updateFilterBar();
});

// --- Load data and dashboard ---
async function initDashboard() {
  try {
    const dataRes = await fetch("/api/data");
    const dataJson = await dataRes.json();
    allRows = dataJson.rows;
  } catch (err) {
    console.error("Failed to fetch data:", err);
  }

  const poll = async () => {
    try {
      const res = await fetch("/api/dashboard");
      const data = await res.json();

      if (!data.ready) {
        setTimeout(poll, 2000);
        return;
      }

      elements.dashboardLoading.classList.add("hidden");

      if (!data.recipes || data.recipes.length === 0) {
        elements.dashboardGrid.innerHTML =
          "<p style='color:var(--muted);padding:20px;'>No charts were generated. Try restarting the server.</p>";
        return;
      }

      dashboardRecipes = data.recipes;
      buildDashboardCards();
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setTimeout(poll, 3000);
    }
  };

  poll();
}

initDashboard();

// --- Chat messages ---
const addMessage = (role, text, chartSpec = null) => {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.textContent = text;

  if (chartSpec) {
    const container = document.createElement("div");
    container.className = "chart-container";
    const plotDiv = document.createElement("div");
    container.appendChild(plotDiv);
    msg.appendChild(container);

    requestAnimationFrame(() => {
      renderChatChart(plotDiv, chartSpec);
    });
  }

  elements.messages.appendChild(msg);
  elements.messages.scrollTop = elements.messages.scrollHeight;
};

const sendQuestion = async (question) => {
  addMessage("user", question);
  elements.userInput.value = "";
  elements.sendBtn.disabled = true;
  elements.userInput.disabled = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, vizMode: elements.vizMode.checked }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMessage("bot", err.error || "Something went wrong.");
      return;
    }

    const data = await res.json();
    addMessage("bot", data.reply, data.chart || null);
  } catch (err) {
    addMessage("bot", "Network error — is the server running?");
  } finally {
    elements.sendBtn.disabled = false;
    elements.userInput.disabled = false;
    elements.userInput.focus();
  }
};

elements.sendBtn.addEventListener("click", () => {
  const input = elements.userInput.value.trim();
  if (!input) return;
  sendQuestion(input);
});

elements.userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    elements.sendBtn.click();
  }
});

document.querySelectorAll(".hint").forEach((btn) => {
  btn.addEventListener("click", () => {
    const query = btn.dataset.q;
    if (!query) return;
    sendQuestion(query);
  });
});

addMessage("bot", "Hi! Ask me anything about the AI Job Displacement Survey dataset. I'm powered by Claude.");
