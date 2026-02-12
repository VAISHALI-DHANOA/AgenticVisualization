const elements = {
  messages: document.getElementById("messages"),
  userInput: document.getElementById("userInput"),
  sendBtn: document.getElementById("sendBtn"),
  vizMode: document.getElementById("vizMode"),
};

const renderChart = (canvas, spec) => {
  const config = {
    type: spec.type,
    data: {
      labels: spec.data.labels,
      datasets: spec.data.datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        title: {
          display: !!spec.title,
          text: spec.title || "",
        },
        legend: {
          display: spec.data.datasets.length > 1 || spec.type === "pie" || spec.type === "doughnut",
        },
      },
      scales: {},
    },
  };

  if (spec.options && ["bar", "line", "scatter"].includes(spec.type)) {
    if (spec.options.xLabel) {
      config.options.scales.x = {
        title: { display: true, text: spec.options.xLabel },
        stacked: spec.options.stacked || false,
      };
    }
    if (spec.options.yLabel) {
      config.options.scales.y = {
        title: { display: true, text: spec.options.yLabel },
        stacked: spec.options.stacked || false,
      };
    }
    if (spec.options.indexAxis) {
      config.options.indexAxis = spec.options.indexAxis;
    }
  }

  new Chart(canvas, config);
};

const addMessage = (role, text, chartSpec = null) => {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.textContent = text;

  if (chartSpec) {
    const container = document.createElement("div");
    container.className = "chart-container";
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    msg.appendChild(container);

    requestAnimationFrame(() => {
      renderChart(canvas, chartSpec);
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
