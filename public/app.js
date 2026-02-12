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

const COLORS = [
  "#3b6ef0", "#f06e3b", "#3bf06e", "#f0c93b", "#b03bf0",
  "#3bf0e0", "#f03b6e", "#6ef03b", "#f0a03b", "#3b9ef0",
  "#e03bf0", "#3bf09e", "#f0d93b", "#6e3bf0", "#3bf0b0",
  "#f03ba0",
];

function getFilteredRows() {
  return allRows.filter((row) => {
    for (const [col, val] of Object.entries(activeFilters)) {
      if (row[col] !== val) return false;
    }
    return true;
  });
}

// --- Aggregation: compute chart data from recipe + rows ---
function computeChartData(recipe, rows) {
  const { type, xColumn, yColumn, aggregation } = recipe;

  if (type === "scatter") {
    return {
      x: rows.map((r) => Number(r[xColumn])),
      y: rows.map((r) => Number(r[yColumn])),
    };
  }

  if (type === "histogram") {
    return {
      values: rows.map((r) => Number(r[xColumn])),
    };
  }

  // bar or pie: group by xColumn
  const groups = {};
  for (const row of rows) {
    const key = row[xColumn] || "Unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  const labels = Object.keys(groups).sort();
  let values;

  if (aggregation === "count") {
    values = labels.map((k) => groups[k].length);
  } else if (aggregation === "average") {
    values = labels.map((k) => {
      const nums = groups[k].map((r) => Number(r[yColumn])).filter((n) => !isNaN(n));
      return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0;
    });
  } else if (aggregation === "sum") {
    values = labels.map((k) => {
      return groups[k].map((r) => Number(r[yColumn])).filter((n) => !isNaN(n)).reduce((a, b) => a + b, 0);
    });
  }

  return { labels, values };
}

// --- Plotly chart rendering ---
const PLOTLY_LAYOUT_BASE = {
  margin: { t: 30, b: 40, l: 50, r: 20 },
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { family: "Inter, system-ui, sans-serif", size: 12 },
  height: 300,
};

const PLOTLY_CONFIG = {
  displayModeBar: false,
  responsive: true,
};

function renderPlotlyChart(container, recipe, rows, isFiltered) {
  const data = computeChartData(recipe, rows);
  let traces, layout;

  if (recipe.type === "bar") {
    const barColors = data.labels.map((label, i) => {
      if (activeFilters[recipe.xColumn] && activeFilters[recipe.xColumn] !== label) {
        return "#d0d5e0";
      }
      return COLORS[i % COLORS.length];
    });
    traces = [{
      type: "bar",
      x: data.labels,
      y: data.values,
      marker: { color: barColors, line: { width: 0 } },
      hovertemplate: "%{x}: %{y}<extra></extra>",
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { title: recipe.xColumn },
      yaxis: { title: recipe.yColumn || (recipe.aggregation === "count" ? "Count" : recipe.yColumn) },
    };
  } else if (recipe.type === "pie") {
    traces = [{
      type: "pie",
      labels: data.labels,
      values: data.values,
      marker: { colors: data.labels.map((_, i) => COLORS[i % COLORS.length]) },
      textinfo: "label+percent",
      hovertemplate: "%{label}: %{value} (%{percent})<extra></extra>",
    }];
    layout = { ...PLOTLY_LAYOUT_BASE };
  } else if (recipe.type === "scatter") {
    traces = [{
      type: "scatter",
      mode: "markers",
      x: data.x,
      y: data.y,
      marker: { color: COLORS[0], size: 6, opacity: 0.6 },
      hovertemplate: `${recipe.xColumn}: %{x}<br>${recipe.yColumn}: %{y}<extra></extra>`,
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { title: recipe.xColumn },
      yaxis: { title: recipe.yColumn },
    };
  } else if (recipe.type === "histogram") {
    traces = [{
      type: "histogram",
      x: data.values,
      marker: { color: COLORS[0], line: { color: "#fff", width: 1 } },
      hovertemplate: "%{x}: %{y}<extra></extra>",
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { title: recipe.xColumn },
      yaxis: { title: "Count" },
    };
  }

  Plotly.newPlot(container, traces, layout, PLOTLY_CONFIG);

  // Add cross-filter click handler for bar and pie charts
  if (recipe.type === "bar" || recipe.type === "pie") {
    container.on("plotly_click", (eventData) => {
      const clickedLabel = eventData.points[0].label || eventData.points[0].x;
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

// --- Chat chart rendering (for inline Plotly charts from the viz mode) ---
function renderChatChart(container, spec) {
  let traces, layout;

  if (spec.type === "scatter") {
    traces = [{
      type: "scatter",
      mode: "markers",
      x: spec.data.x,
      y: spec.data.y,
      marker: { color: COLORS[0], size: 6, opacity: 0.6 },
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { title: spec.xLabel || "" },
      yaxis: { title: spec.yLabel || "" },
    };
  } else if (spec.type === "histogram") {
    traces = [{
      type: "histogram",
      x: spec.data.values || spec.data.labels,
      marker: { color: COLORS[0] },
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { title: spec.xLabel || "" },
      yaxis: { title: spec.yLabel || "Count" },
    };
  } else if (spec.type === "pie") {
    traces = [{
      type: "pie",
      labels: spec.data.labels,
      values: spec.data.values,
      marker: { colors: (spec.data.labels || []).map((_, i) => COLORS[i % COLORS.length]) },
    }];
    layout = { ...PLOTLY_LAYOUT_BASE };
  } else {
    // bar (default)
    traces = [{
      type: "bar",
      x: spec.data.labels,
      y: spec.data.values,
      marker: { color: COLORS[0] },
    }];
    layout = {
      ...PLOTLY_LAYOUT_BASE,
      xaxis: { title: spec.xLabel || "" },
      yaxis: { title: spec.yLabel || "" },
    };
  }

  if (spec.title) {
    layout.title = { text: spec.title, font: { size: 14 } };
  }

  Plotly.newPlot(container, traces, layout, PLOTLY_CONFIG);
}

// --- Dashboard rendering ---
function renderAllDashboardCharts() {
  const rows = getFilteredRows();
  const cards = elements.dashboardGrid.querySelectorAll(".dashboard-card");

  cards.forEach((card, i) => {
    const recipe = dashboardRecipes[i];
    if (!recipe) return;
    const plotDiv = card.querySelector(".plot-div");
    renderPlotlyChart(plotDiv, recipe, rows, Object.keys(activeFilters).length > 0);
  });
}

function buildDashboardCards() {
  elements.dashboardGrid.innerHTML = "";

  for (const recipe of dashboardRecipes) {
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

    const plotDiv = document.createElement("div");
    plotDiv.className = "plot-div";
    card.appendChild(plotDiv);
    elements.dashboardGrid.appendChild(card);
  }

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

  // Chip remove handlers
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
  // Fetch raw data for client-side filtering
  try {
    const dataRes = await fetch("/api/data");
    const dataJson = await dataRes.json();
    allRows = dataJson.rows;
  } catch (err) {
    console.error("Failed to fetch data:", err);
  }

  // Poll for dashboard recipes
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
