const API_BASE = "https://api.mimuu.ai";

const el = {
  title: document.getElementById("title"),
  subtitle: document.getElementById("subtitle"),
  health: document.getElementById("health"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
};

const params = new URLSearchParams(window.location.search);
const token = params.get("token") || "";

function addMsg(text, kind = "system") {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function sendMessage() {
  const message = el.input.value.trim();
  if (!message || !token) return;
  el.input.value = "";
  addMsg(message, "user");
  el.send.disabled = true;
  el.health.textContent = "enviando...";

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
    if (!res.ok) throw new Error(data?.detail || "Erro ao enviar");

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

function boot() {
  if (!token) {
    el.subtitle.textContent = "Token ausente";
    el.health.textContent = "inválido";
    el.health.className = "small status-err";
    addMsg("Link inválido. Abra /chat?token=SEU_TOKEN", "system");
    el.send.disabled = true;
    el.input.disabled = true;
    return;
  }

  el.subtitle.textContent = "Sessão conectada";
  el.health.textContent = "online";
  el.health.className = "small status-ok";
  addMsg("Tudo pronto. Pode mandar mensagem 🙂", "system");
}

el.send.addEventListener("click", sendMessage);
el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

boot();
