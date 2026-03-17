const API_BASE = "https://api.mimuu.ai";

const el = {
  loginView: document.getElementById("loginView"),
  chatView: document.getElementById("chatView"),
  email: document.getElementById("email"),
  loginBtn: document.getElementById("loginBtn"),
  loginStatus: document.getElementById("loginStatus"),
  logoutBtn: document.getElementById("logoutBtn"),
  badge: document.getElementById("badge"),
  title: document.getElementById("title"),
  subtitle: document.getElementById("subtitle"),
  health: document.getElementById("health"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
};

// --- State ---
let token = "";
let mimuuName = "";
let ownerName = "";

function persist() {
  localStorage.setItem("mimuu_chat", JSON.stringify({ token, mimuuName, ownerName }));
}

function restore() {
  try {
    const raw = localStorage.getItem("mimuu_chat");
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.token) return false;
    token = data.token;
    mimuuName = data.mimuuName || "";
    ownerName = data.ownerName || "";
    return true;
  } catch { return false; }
}

function logout() {
  token = "";
  mimuuName = "";
  ownerName = "";
  localStorage.removeItem("mimuu_chat");
  el.chatView.style.display = "none";
  el.loginView.style.display = "flex";
  el.messages.innerHTML = "";
  el.loginStatus.textContent = "";
}

// --- Thinking phases ---
const THINKING_PHASES = [
  { text: "Lendo sua mensagem", icon: "📖", minMs: 800 },
  { text: "Pensando", icon: "🧠", minMs: 1200 },
  { text: "Preparando resposta", icon: "✍️", minMs: 1000 },
  { text: "Escrevendo", icon: "💭", minMs: 0 },
];

class ThinkingIndicator {
  constructor(container) {
    this.container = container;
    this.el = null;
    this.textEl = null;
    this.phase = 0;
    this.timer = null;
    this.startTime = 0;
  }

  start() {
    this.phase = 0;
    this.startTime = Date.now();
    this.el = document.createElement("div");
    this.el.className = "msg ai thinking-bubble";
    this.el.innerHTML = `
      <span class="thinking-icon"></span>
      <span class="thinking-text"></span>
      <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
    `;
    this.textEl = this.el.querySelector(".thinking-text");
    this.iconEl = this.el.querySelector(".thinking-icon");
    this.container.appendChild(this.el);
    this.container.scrollTop = this.container.scrollHeight;
    this._show();
    this._scheduleNext();
  }

  _show() {
    const p = THINKING_PHASES[this.phase];
    this.iconEl.textContent = p.icon;
    this.textEl.textContent = p.text;
    this.el.classList.add("visible");
  }

  _scheduleNext() {
    if (this.phase >= THINKING_PHASES.length - 1) return;
    const p = THINKING_PHASES[this.phase];
    this.timer = setTimeout(() => {
      this.phase++;
      this._show();
      this._scheduleNext();
    }, p.minMs);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.el) this.el.remove();
    this.el = null;
  }
}

// --- UI helpers ---
function addMsg(text, kind = "system") {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
  return div;
}

function createStreamBubble() {
  const div = document.createElement("div");
  div.className = "msg ai streaming";
  div.innerHTML = '<span class="stream-content"></span><span class="cursor-blink">▌</span>';
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
  return {
    el: div,
    content: div.querySelector(".stream-content"),
    cursor: div.querySelector(".cursor-blink"),
    text: "",
    append(chunk) {
      this.text += chunk;
      this.content.textContent = this.text;
      el.messages.scrollTop = el.messages.scrollHeight;
    },
    finish() {
      this.cursor.remove();
      this.el.classList.remove("streaming");
    }
  };
}

function openChat() {
  el.loginView.style.display = "none";
  el.chatView.style.display = "block";
  el.title.textContent = mimuuName ? `Chat com ${mimuuName}` : "Seu chat com o Mimuu";
  el.subtitle.textContent = ownerName ? `Olá, ${ownerName}` : "Conectado";
  el.health.textContent = "online";
  el.health.className = "small status-ok";
  addMsg("Tudo pronto. Pode mandar mensagem 🙂", "system");
  el.input.focus();
}

// --- Login ---
async function login() {
  const email = el.email.value.trim();
  if (!email) return;

  el.loginBtn.disabled = true;
  el.loginStatus.textContent = "entrando...";
  el.loginStatus.style.color = "var(--muted)";

  try {
    const res = await fetch(`${API_BASE}/api/chat/user-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "Falha no login");

    token = data.token;
    mimuuName = data.mimuu_name || "";
    ownerName = data.owner_name || "";
    persist();
    openChat();
  } catch (err) {
    el.loginStatus.textContent = err.message;
    el.loginStatus.style.color = "var(--danger)";
  } finally {
    el.loginBtn.disabled = false;
  }
}

// --- Chat (streaming) ---
async function sendMessage() {
  const message = el.input.value.trim();
  if (!message || !token) return;
  el.input.value = "";
  el.input.style.height = "auto";
  addMsg(message, "user");
  el.send.disabled = true;
  el.input.disabled = true;

  const thinking = new ThinkingIndicator(el.messages);
  thinking.start();

  try {
    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) { thinking.stop(); logout(); return; }
      throw new Error(err?.detail || `Erro ${res.status}`);
    }

    // SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let bubble = null;
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.error) throw new Error(data.error);

          if (data.token && !bubble) {
            thinking.stop();
            bubble = createStreamBubble();
          }

          if (data.token) bubble.append(data.token);

          if (data.done) {
            if (bubble) bubble.finish();
            else {
              thinking.stop();
              addMsg("(sem resposta)", "system");
            }
          }
        } catch (e) {
          if (e.message !== "Unexpected end of JSON input") {
            thinking.stop();
            if (bubble) bubble.finish();
            addMsg(`Erro: ${e.message}`, "system");
          }
        }
      }
    }

    // Handle case where stream ends without [DONE]
    if (bubble && bubble.el.classList.contains("streaming")) bubble.finish();
    thinking.stop();

    el.health.textContent = "online";
    el.health.className = "small status-ok";

  } catch (err) {
    thinking.stop();
    addMsg(`Falha: ${err.message}`, "system");
    el.health.textContent = "erro";
    el.health.className = "small status-err";
  } finally {
    el.send.disabled = false;
    el.input.disabled = false;
    el.input.focus();
  }
}

// --- Boot ---
function boot() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    token = urlToken;
    persist();
    window.history.replaceState({}, "", "/chat");
    openChat();
    return;
  }

  if (restore()) {
    openChat();
    return;
  }

  el.loginView.style.display = "flex";
}

// --- Events ---
el.loginBtn.addEventListener("click", login);
el.email.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
el.logoutBtn.addEventListener("click", logout);
el.send.addEventListener("click", sendMessage);
el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

boot();
