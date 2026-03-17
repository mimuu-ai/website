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
let isStreaming = false;

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

// --- Simple markdown rendering ---
function renderMarkdown(text) {
  return text
    // code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // line breaks
    .replace(/\n/g, '<br>');
}

// --- UI helpers ---
function addMsg(text, kind = "system") {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  if (kind === "ai") {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
  return div;
}

function createStreamingMsg() {
  const div = document.createElement("div");
  div.className = "msg ai streaming";
  div.innerHTML = '<span class="cursor"></span>';
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
  return div;
}

function appendToStreamingMsg(div, token) {
  // Remove cursor, append text, re-add cursor
  const cursor = div.querySelector(".cursor");
  if (cursor) cursor.remove();
  
  // Append raw text to a data attribute for final markdown render
  const raw = (div.dataset.raw || "") + token;
  div.dataset.raw = raw;
  
  // Render incrementally
  div.innerHTML = renderMarkdown(raw) + '<span class="cursor"></span>';
  el.messages.scrollTop = el.messages.scrollHeight;
}

function finalizeStreamingMsg(div) {
  const cursor = div.querySelector(".cursor");
  if (cursor) cursor.remove();
  div.classList.remove("streaming");
  // Final clean render
  const raw = div.dataset.raw || "";
  if (raw) div.innerHTML = renderMarkdown(raw);
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
  if (!message || !token || isStreaming) return;
  el.input.value = "";
  addMsg(message, "user");
  
  isStreaming = true;
  el.send.disabled = true;
  el.input.disabled = true;
  el.health.textContent = "pensando...";
  el.health.className = "small";

  const streamDiv = createStreamingMsg();

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
      if (res.status === 401) { logout(); return; }
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail || `Erro ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.error) {
            appendToStreamingMsg(streamDiv, `\n⚠️ ${data.error}`);
            break;
          }
          if (data.done) break;
          if (data.token) {
            el.health.textContent = "respondendo...";
            appendToStreamingMsg(streamDiv, data.token);
          }
        } catch { /* skip malformed */ }
      }
    }

    finalizeStreamingMsg(streamDiv);
    el.health.textContent = "online";
    el.health.className = "small status-ok";

  } catch (err) {
    finalizeStreamingMsg(streamDiv);
    if (!streamDiv.dataset.raw) {
      streamDiv.remove();
    }
    addMsg(`Falha: ${err.message}`, "system");
    el.health.textContent = "erro";
    el.health.className = "small status-err";
  } finally {
    isStreaming = false;
    el.send.disabled = false;
    el.input.disabled = false;
    el.input.focus();
  }
}

// --- Fallback: non-streaming send (if stream fails) ---
async function sendMessageFallback() {
  const message = el.input.value.trim();
  if (!message || !token) return;
  el.input.value = "";
  addMsg(message, "user");
  el.send.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/chat/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "Erro");
    addMsg(data.reply || "(sem texto)", "ai");
  } catch (err) {
    addMsg(`Falha: ${err.message}`, "system");
  } finally {
    el.send.disabled = false;
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
