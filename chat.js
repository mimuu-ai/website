const API_BASE = "https://api.mimuu.ai";

const el = {
  loginView: document.getElementById("loginView"),
  chatView: document.getElementById("chatView"),
  email: document.getElementById("email"),
  loginBtn: document.getElementById("loginBtn"),
  loginStatus: document.getElementById("loginStatus"),
  logoutBtn: document.getElementById("logoutBtn"),
  // badge removed — now in sidebar
  title: document.getElementById("title"),
  health: document.getElementById("health"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  fileInput: document.getElementById("fileInput"),
  attachBtn: document.getElementById("attachBtn"),
  recBtn: document.getElementById("recBtn"),
  attachCount: document.getElementById("attachCount"),
  newChatBtn: document.getElementById("newChatBtn"),
};

// Configure marked for safe rendering
if (window.marked) {
  marked.setOptions({ breaks: true, gfm: true });
}

function renderMarkdown(text) {
  if (!window.marked || !text) return escapeHtml(text || "");
  try {
    return marked.parse(text);
  } catch { return escapeHtml(text); }
}

function escapeHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// --- State ---
let token = "";
let mimuuName = "";
let ownerName = "";
let pendingAttachments = [];
let mediaRecorder = null;
let mediaChunks = [];

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
  pendingAttachments = [];
  updateAttachmentBadge();
  localStorage.removeItem("mimuu_chat");
  el.chatView.style.display = "none";
  el.loginView.style.display = "flex";
  el.loginStatus.textContent = "";
  loginStep = "email";
  pendingEmail = "";
  el.email.readOnly = false;
  el.email.value = "";
  const pw = document.getElementById("password");
  if (pw) { pw.style.display = "none"; pw.value = ""; }
  const rc = document.getElementById("resetCode");
  if (rc) { rc.style.display = "none"; rc.value = ""; }
  const fl = document.getElementById("forgotLink");
  if (fl) fl.style.display = "none";
  const sub = document.getElementById("loginSub");
  if (sub) sub.textContent = "Entre com seu email ou nome";
  el.loginBtn.textContent = "Continuar";
  el.messages.innerHTML = "";
  el.loginStatus.textContent = "";
}

function updateAttachmentBadge() {
  if (!pendingAttachments.length) {
    el.attachCount.textContent = "";
    return;
  }
  const names = pendingAttachments.slice(0, 2).map(a => a.name).join(", ");
  const more = pendingAttachments.length > 2 ? ` +${pendingAttachments.length - 2}` : "";
  el.attachCount.textContent = `${pendingAttachments.length} anexo(s): ${names}${more}`;
}

function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",", 2)[1] : "";
      resolve({
        name: file.name,
        mime: file.type || "application/octet-stream",
        data_base64: base64,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addSelectedFiles(fileList) {
  const files = Array.from(fileList || []).slice(0, 5);
  for (const f of files) {
    const att = await fileToAttachment(f);
    pendingAttachments.push(att);
  }
  pendingAttachments = pendingAttachments.slice(0, 5);
  updateAttachmentBadge();
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    el.recBtn.classList.remove("recording");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) mediaChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(mediaChunks, { type: "audio/webm" });
      const file = new File([blob], `audio-${Date.now()}.webm`, { type: "audio/webm" });
      const att = await fileToAttachment(file);
      pendingAttachments.push(att);
      pendingAttachments = pendingAttachments.slice(0, 5);
      updateAttachmentBadge();
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    el.recBtn.classList.add("recording");
  } catch (e) {
    addMsg("Não consegui acessar o microfone.", "system");
  }
}

// --- Thinking phases ---
const THINKING_PHASES = [
  { text: "Lendo", minMs: 800 },
  { text: "Pensando", minMs: 1500 },
  { text: "Escrevendo", minMs: 0 },
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
      <span class="thinking-ball"></span>
      <span class="thinking-text"></span>
    `;
    this.textEl = this.el.querySelector(".thinking-text");
    this.container.appendChild(this.el);
    this.container.scrollTop = this.container.scrollHeight;
    this._show();
    this._scheduleNext();
  }

  _show() {
    const p = THINKING_PHASES[this.phase];
    this.textEl.textContent = p.text + "…";
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
let currentAudio = null;

function addMsg(text, kind = "system") {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  if (kind === "ai") {
    div.innerHTML = renderMarkdown(text);
    // TTS button
    const ttsBtn = document.createElement("button");
    ttsBtn.className = "tts-btn";
    ttsBtn.textContent = "🔊";
    ttsBtn.title = "Ouvir";
    ttsBtn.dataset.text = text;
    ttsBtn.addEventListener("click", () => playTTS(ttsBtn));
    div.appendChild(ttsBtn);
  } else if (kind === "user") {
    const content = document.createElement("div");
    content.className = "msg-content";
    content.textContent = text;
    div.appendChild(content);
  } else {
    div.textContent = text;
  }
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
  return div;
}

async function playTTS(btn) {
  // Stop if already playing
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio = null;
    btn.textContent = "🔊";
    return;
  }

  const text = btn.dataset.text;
  if (!text || !token) return;

  btn.textContent = "⏳";
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/chat/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: text.slice(0, 2000) }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail || "Erro no TTS");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    currentAudio = new Audio(url);
    currentAudio.addEventListener("ended", () => {
      btn.textContent = "🔊";
      URL.revokeObjectURL(url);
      currentAudio = null;
    });
    currentAudio.addEventListener("error", () => {
      btn.textContent = "🔊";
      currentAudio = null;
    });
    btn.textContent = "⏹️";
    await currentAudio.play();
  } catch (e) {
    addMsg(`🔊 ${e.message}`, "system");
    btn.textContent = "🔊";
  } finally {
    btn.disabled = false;
  }
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
    displayed: "",
    queue: "",
    _timer: null,
    append(chunk) {
      this.text += chunk;
      this.queue += chunk;
      if (!this._timer) this._drain();
    },
    _drain() {
      if (!this.queue.length) { this._timer = null; return; }
      const batch = this.queue.length > 20 ? 3 : 1;
      this.displayed += this.queue.slice(0, batch);
      this.queue = this.queue.slice(batch);
      this.content.textContent = this.displayed;
      el.messages.scrollTop = el.messages.scrollHeight;
      this._timer = setTimeout(() => this._drain(), 12);
    },
    finish() {
      if (this._timer) clearTimeout(this._timer);
      this.cursor.remove();
      this.el.classList.remove("streaming");
      this.el.innerHTML = renderMarkdown(this.text);
      const ttsBtn = document.createElement("button");
      ttsBtn.className = "tts-btn";
      ttsBtn.textContent = "🔊";
      ttsBtn.title = "Ouvir";
      ttsBtn.dataset.text = this.text;
      ttsBtn.addEventListener("click", () => playTTS(ttsBtn));
      this.el.appendChild(ttsBtn);
    }
  };
}

async function loadHistory() {
  if (!token) return [];
  const res = await fetch(`${API_BASE}/api/chat/history?limit=80`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

function renderHistory(items) {
  el.messages.innerHTML = "";
  if (!items.length) {
    addMsg("Comece uma conversa", "system");
    return;
  }
  for (const it of items) {
    const kind = it.role === "assistant" ? "ai" : "user";
    addMsg(it.text, kind);
  }
}

async function openChat() {
  el.loginView.style.display = "none";
  el.chatView.style.display = "flex";
  document.getElementById("sidebar")?.style.setProperty("display", "flex");
  el.title.textContent = mimuuName || "Mimuu";
  el.health.textContent = "sincronizando…";
  el.health.className = "topbar-status";

  const items = await loadHistory().catch(() => []);
  renderHistory(items);

  el.health.textContent = "online";
  el.health.className = "topbar-status online";
  el.input.focus();

  // Load sidebar data
  updateSidebarUser();
  loadSidebarProjects();
}

// --- Forgot password ---
async function startForgot() {
  const email = el.email.value.trim();
  if (!email) return;

  const loginSub = document.getElementById("loginSub");
  const passwordEl = document.getElementById("password");
  const resetCodeEl = document.getElementById("resetCode");
  const forgotLink = document.getElementById("forgotLink");

  el.loginBtn.disabled = true;
  el.loginStatus.textContent = "Enviando código…";
  el.loginStatus.style.color = "";

  try {
    const res = await fetch(`${API_BASE}/api/chat/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "Erro ao enviar código");

    loginStep = "forgot-sent";
    if (loginSub) loginSub.textContent = "Digite o código enviado por email";
    if (passwordEl) passwordEl.style.display = "none";
    if (resetCodeEl) { resetCodeEl.style.display = ""; resetCodeEl.focus(); }
    if (forgotLink) forgotLink.style.display = "none";
    el.loginBtn.textContent = "Verificar código";
    el.loginStatus.textContent = "📧 Código enviado!";
    el.loginStatus.style.color = "#ff8f00";
  } catch (err) {
    el.loginStatus.textContent = err.message;
  } finally {
    el.loginBtn.disabled = false;
  }
}

// --- Login ---
let loginStep = "email"; // "email" | "password" | "create-password" | "forgot-sent" | "reset-password"
let pendingEmail = "";

async function login() {
  const email = el.email.value.trim();
  const passwordEl = document.getElementById("password");
  const password = passwordEl?.value || "";
  const loginSub = document.getElementById("loginSub");
  const resetCodeEl = document.getElementById("resetCode");
  const forgotLink = document.getElementById("forgotLink");

  if (!email) return;

  el.loginBtn.disabled = true;
  el.loginStatus.textContent = "";

  try {
    if (loginStep === "reset-password") {
      // Setting new password after code verification
      if (password.length < 4) {
        el.loginStatus.textContent = "Senha deve ter pelo menos 4 caracteres";
        return;
      }
      const code = resetCodeEl?.value?.trim() || "";
      const res = await fetch(`${API_BASE}/api/chat/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, new_password: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Erro ao redefinir senha");

      token = data.token;
      mimuuName = data.mimuu_name || "";
      ownerName = data.owner_name || "";
      persist();
      await openChat();
      return;
    }

    if (loginStep === "forgot-sent") {
      // User entered the code — show new password field
      const code = resetCodeEl?.value?.trim() || "";
      if (code.length !== 6) {
        el.loginStatus.textContent = "Digite o código de 6 dígitos";
        return;
      }
      loginStep = "reset-password";
      if (loginSub) loginSub.textContent = "Crie sua nova senha";
      passwordEl.style.display = "";
      passwordEl.placeholder = "Nova senha";
      passwordEl.value = "";
      passwordEl.focus();
      el.loginBtn.textContent = "Redefinir senha";
      return;
    }

    if (loginStep === "create-password") {
      // Setting password for the first time
      if (password.length < 4) {
        el.loginStatus.textContent = "Senha deve ter pelo menos 4 caracteres";
        return;
      }
      const isEmail = email.includes("@");
      const setBody = isEmail ? { email, password } : { username: email, password };
      const res = await fetch(`${API_BASE}/api/chat/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setBody),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Erro ao criar senha");

      token = data.token;
      mimuuName = data.mimuu_name || "";
      ownerName = data.owner_name || "";
      persist();
      await openChat();
      return;
    }

    // Normal login flow — detect email vs name
    const isEmail = email.includes("@");
    const body = isEmail ? { email } : { username: email };
    if (loginStep === "password") body.password = password;

    const res = await fetch(`${API_BASE}/api/chat/user-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.needs_password) {
      // First time — ask to create password
      pendingEmail = email;
      loginStep = "create-password";
      if (loginSub) loginSub.textContent = `Olá, ${data.owner_name || ""}! Crie uma senha para acessar pelo navegador`;
      passwordEl.style.display = "";
      passwordEl.placeholder = "Crie uma senha";
      passwordEl.autocomplete = "new-password";
      passwordEl.focus();
      el.loginBtn.textContent = "Criar senha";
      el.email.readOnly = true;
      return;
    }

    if (!res.ok) {
      if (res.status === 401 && loginStep === "email") {
        // Has password, need to enter it
        loginStep = "password";
        if (loginSub) loginSub.textContent = "Digite sua senha";
        passwordEl.style.display = "";
        passwordEl.placeholder = "Senha";
        passwordEl.autocomplete = "current-password";
        passwordEl.focus();
        el.loginBtn.textContent = "Entrar";
        el.email.readOnly = true;
        if (forgotLink) forgotLink.style.display = "";
        return;
      }
      throw new Error(data?.detail || "Falha no login");
    }

    token = data.token;
    mimuuName = data.mimuu_name || "";
    ownerName = data.owner_name || "";
    persist();
    await openChat();
  } catch (err) {
    el.loginStatus.textContent = err.message;
  } finally {
    el.loginBtn.disabled = false;
  }
}

// --- Chat (streaming) ---
async function sendMessage() {
  const message = el.input.value.trim();
  if ((!message && !pendingAttachments.length) || !token) return;
  el.input.value = "";
  el.input.style.height = "auto";

  const userBubble = addMsg(message || "", "user");
  if (pendingAttachments.length) {
    const contentEl = userBubble.querySelector(".msg-content") || userBubble;
    const attDiv = document.createElement("div");
    attDiv.className = "msg-attachment";
    for (const att of pendingAttachments) {
      if (att.mime.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = `data:${att.mime};base64,${att.data_base64}`;
        img.alt = att.name;
        img.title = att.name;
        img.addEventListener("click", () => window.open(img.src, "_blank"));
        attDiv.appendChild(img);
      } else if (att.mime.startsWith("audio/")) {
        const card = document.createElement("span");
        card.className = "att-card";
        card.innerHTML = `🎙️ ${att.name}`;
        attDiv.appendChild(card);
      } else {
        const card = document.createElement("span");
        card.className = "att-card";
        card.innerHTML = `📄 ${att.name}`;
        attDiv.appendChild(card);
      }
    }
    contentEl.appendChild(attDiv);
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  const attachmentsToSend = [...pendingAttachments];
  pendingAttachments = [];
  updateAttachmentBadge();

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
      body: JSON.stringify({ message, attachments: attachmentsToSend }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) { thinking.stop(); logout(); return; }
      if (res.status === 429) {
        thinking.stop();
        addMsg("⏳ Muitas mensagens seguidas. Espere uns segundos e tente de novo.", "system");
        return;
      }
      if (res.status === 503) {
        thinking.stop();
        addMsg("😴 Seu Mimuu está dormindo ou em manutenção. Tente de novo em alguns segundos.", "system");
        el.health.textContent = "offline";
        el.health.className = "topbar-status error";
        return;
      }
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
    el.health.className = "topbar-status online";

  } catch (err) {
    thinking.stop();
    const msg = err.message.includes("Failed to fetch") || err.message.includes("NetworkError")
      ? "📡 Sem conexão. Verifique sua internet e tente de novo."
      : err.message.includes("timeout") || err.message.includes("Timeout")
      ? "⏱️ O Mimuu demorou pra responder. Tente de novo."
      : `❌ ${err.message}`;
    addMsg(msg, "system");
    el.health.textContent = "erro";
    el.health.className = "topbar-status error";
  } finally {
    el.send.disabled = false;
    el.input.disabled = false;
    el.input.focus();
  }
}

// --- Boot ---
async function boot() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    token = urlToken;
    persist();
    window.history.replaceState({}, "", "/chat");
    await openChat();
    return;
  }

  if (restore()) {
    await openChat();
    return;
  }

  el.loginView.style.display = "flex";
  document.getElementById("sidebar")?.style.setProperty("display", "none");
}

// --- Events ---
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", (e) => { e.preventDefault(); login(); });
} else {
  el.loginBtn.addEventListener("click", login);
  el.email.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
}
document.getElementById("forgotLink")?.addEventListener("click", (e) => { e.preventDefault(); startForgot(); });
el.newChatBtn?.addEventListener("click", () => {
  el.messages.innerHTML = "";
  addMsg("Nova conversa", "system");
  el.input.focus();
});
el.logoutBtn.addEventListener("click", logout);
el.send.addEventListener("click", sendMessage);
el.attachBtn?.addEventListener("click", () => el.fileInput?.click());
el.fileInput?.addEventListener("change", async (e) => {
  await addSelectedFiles(e.target.files);
  e.target.value = "";
});
el.recBtn?.addEventListener("click", toggleRecording);
el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
el.input.addEventListener("input", () => {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 160) + "px";
});

// --- Sidebar ---
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function openSidebar() {
  sidebar?.classList.add("open");
  sidebarOverlay?.classList.add("active");
}
function closeSidebar() {
  sidebar?.classList.remove("open");
  sidebarOverlay?.classList.remove("active");
}

document.getElementById("menuBtn")?.addEventListener("click", () => {
  if (window.innerWidth <= 768) {
    openSidebar();
  } else {
    sidebar?.classList.remove("collapsed");
  }
});
document.getElementById("sidebarClose")?.addEventListener("click", () => {
  // On mobile: close overlay. On desktop: collapse sidebar.
  if (window.innerWidth <= 768) {
    closeSidebar();
  } else {
    sidebar?.classList.toggle("collapsed");
  }
});
sidebarOverlay?.addEventListener("click", closeSidebar);

// New chat from sidebar
document.getElementById("newChatNav")?.addEventListener("click", () => {
  el.messages.innerHTML = "";
  addMsg("Nova conversa", "system");
  el.input.focus();
  closeSidebar();
});

async function loadSidebarProjects() {
  if (!token) return;
  const container = document.getElementById("sidebarProjects");
  if (!container) return;
  
  try {
    const res = await fetch(`${API_BASE}/api/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const projects = await res.json();
    
    if (!projects.length) {
      container.innerHTML = `<a href="/projects" class="project-item" style="color:#6b6860">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Criar projeto
      </a>`;
      return;
    }
    
    let html = '';
    for (const p of projects.slice(0, 8)) {
      html += `<a href="/projects?project=${p.slug}" class="project-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
      </a>`;
    }
    if (projects.length > 8) {
      html += `<a href="/projects" class="project-item" style="color:#6b6860">Ver todos (${projects.length})</a>`;
    }
    container.innerHTML = html;
  } catch {}
}

function updateSidebarUser() {
  const avatar = document.getElementById("userAvatar");
  const name = document.getElementById("userName");
  if (avatar && ownerName) avatar.textContent = ownerName.charAt(0).toUpperCase();
  if (name) name.textContent = ownerName || "Usuário";
}

boot();
