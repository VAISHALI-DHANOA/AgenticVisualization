const elements = {
  messages: document.getElementById("messages"),
  userInput: document.getElementById("userInput"),
  sendBtn: document.getElementById("sendBtn"),
};

const addMessage = (role, text) => {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.textContent = text;
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
      body: JSON.stringify({ question }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMessage("bot", err.error || "Something went wrong.");
      return;
    }

    const data = await res.json();
    addMessage("bot", data.reply);
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
