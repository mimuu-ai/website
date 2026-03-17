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

// --- UI helpers ---
function addMsg(text, kind = "system") {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
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
    mimuuName = data.mimuu_name || data.mimuu_name || "";
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

// --- Chat ---
async function sendMessage() {
  const message = el.input.value.trim();
  if (!message || !token) return;
  el.input.value = "";
  addMsg(message, "user");
  el.send.disabled = true;
  el.health.textContent = "enviando...";
  el.health.className = "small";

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
    if (!res.ok) {
      if (res.status === 401) { logout(); return; }
      throw new Error(data?.detail || "Erro ao enviar");
    }

    addMsg(data.reply || "(sem texto)", "ai");
    el.health.textContent = "online";
    el.health.className = "small status-ok";
  } catch (err) {
    addMsg(`Falha: ${err.message}`, "system");
    el.health.textContent = "erro";
    el.health.className = "small status-err";
  } finally {
    el.send.disabled = false;
  }
}

// --- Boot ---
function boot() {
  // Check URL param first (legacy link support)
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    token = urlToken;
    persist();
    window.history.replaceState({}, "", "/chat");
    openChat();
    return;
  }

  // Check localStorage
  if (restore()) {
    openChat();
    return;
  }

  // Show login
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
