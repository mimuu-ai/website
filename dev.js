const API_BASE = "https://api.mimuu.ai";

const el = {
  loginCard: document.getElementById("loginCard"),
  app: document.getElementById("app"),
  password: document.getElementById("password"),
  login: document.getElementById("login"),
  loginStatus: document.getElementById("loginStatus"),
  refresh: document.getElementById("refresh"),
  instanceList: document.getElementById("instanceList"),
  devTitle: document.getElementById("devTitle"),
  devSub: document.getElementById("devSub"),
  devHealth: document.getElementById("devHealth"),
  devMessages: document.getElementById("devMessages"),
  devInput: document.getElementById("devInput"),
  devSend: document.getElementById("devSend"),
};

let adminToken = localStorage.getItem("mimuu_dev_token") || "";
let selected = null;
const transcripts = new Map();

function addMsg(text, kind = "system") {
  if (!selected) return;
  const list = transcripts.get(selected.mimo_id) || [];
  list.push({ text, kind });
  transcripts.set(selected.mimo_id, list);
  renderTranscript();
}

function renderTranscript() {
  el.devMessages.innerHTML = "";
  const list = (selected && transcripts.get(selected.mimo_id)) || [
    { text: "Modo dev invisível ativo. Sessão isolada do usuário.", kind: "system" },
  ];

  for (const item of list) {
    const div = document.createElement("div");
    div.className = `msg ${item.kind}`;
    div.textContent = item.text;
    el.devMessages.appendChild(div);
  }
  el.devMessages.scrollTop = el.devMessages.scrollHeight;
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || `Erro ${res.status}`);
  return data;
}

async function login() {
  const password = el.password.value.trim();
  if (!password) return;

  el.login.disabled = true;
  el.loginStatus.textContent = "autenticando...";

  try {
    const data = await fetch(`${API_BASE}/api/chat/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail || "Falha de login");
      return d;
    });

    adminToken = data.token;
    localStorage.setItem("mimuu_dev_token", adminToken);
    el.loginStatus.textContent = "ok";
    await loadInstances();
    openApp();
  } catch (err) {
    el.loginStatus.textContent = err.message;
  } finally {
    el.login.disabled = false;
  }
}

async function loadInstances() {
  const items = await api("/api/chat/instances");
  el.instanceList.innerHTML = "";

  for (const inst of items) {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <strong>${inst.mimuu_name || inst.owner_name || inst.dir_name}</strong>
      <div class="small">${inst.owner_name} · ${inst.dir_name}</div>
      <div class="small">${inst.mimo_id}</div>
    `;
    div.addEventListener("click", () => selectInstance(inst, div));
    el.instanceList.appendChild(div);
  }
}

function selectInstance(inst, node) {
  selected = inst;
  for (const child of el.instanceList.children) child.classList.remove("active");
  node.classList.add("active");
  el.devTitle.textContent = `Teste: ${inst.mimuu_name || inst.owner_name}`;
  el.devSub.textContent = `${inst.mimo_id} · ${inst.dir_name}`;
  renderTranscript();
}

async function sendDev() {
  const message = el.devInput.value.trim();
  if (!message || !selected) return;
  el.devInput.value = "";
  addMsg(message, "user");
  el.devSend.disabled = true;
  el.devHealth.textContent = "enviando...";

  try {
    const data = await api("/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ message, mimo_id: selected.mimo_id }),
    });
    addMsg(data.reply || "(sem texto)", "ai");
    el.devHealth.textContent = "online";
    el.devHealth.className = "small status-ok";
  } catch (err) {
    addMsg(`Falha: ${err.message}`, "system");
    el.devHealth.textContent = "erro";
    el.devHealth.className = "small status-err";
  } finally {
    el.devSend.disabled = false;
  }
}

function openApp() {
  el.loginCard.style.display = "none";
  el.app.style.display = "grid";
}

async function boot() {
  if (!adminToken) return;
  try {
    await loadInstances();
    openApp();
  } catch {
    localStorage.removeItem("mimuu_dev_token");
    adminToken = "";
  }
}

el.login.addEventListener("click", login);
el.refresh.addEventListener("click", loadInstances);
el.devSend.addEventListener("click", sendDev);
el.devInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendDev();
  }
});

boot();
