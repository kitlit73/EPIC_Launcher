/* ============================================================
   EPIC LAUNCHER — логика интерфейса
   ============================================================ */
"use strict";

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

/* ---------- Звук клика в стиле Minecraft (WebAudio) ---------- */
let audioCtx = null;
function clickSound(freq = 620, dur = 0.07, type = "square", vol = 0.08) {
  if (!$("#setSound") || $("#setSound").checked === false) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* без звука */ }
}

/* ---------- Тосты ---------- */
function toast(msg, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.classList.add("is-out"); setTimeout(() => t.remove(), 400); }, ms);
}

/* ---------- Версии игры (реальный список piston-meta) ---------- */
let REAL_VERSIONS = [];           // [{id,type,url,releaseTime}]
const FALLBACK_VERSIONS = [
  { id: "1.21.4", type: "release" }, { id: "1.20.1", type: "release" },
  { id: "1.16.5", type: "release" }, { id: "1.12.2", type: "release" },
  { id: "1.8.9", type: "release" },
];
let versionFilter = "";           // строка поиска
let versionTab = "all";           // all | release | snapshot | old

function typeName(t) {
  return { release: "Release", snapshot: "Snapshot", old_beta: "Beta", old_alpha: "Alpha" }[t] || t;
}

function allVersionItems() {
  const src = REAL_VERSIONS.length ? REAL_VERSIONS : FALLBACK_VERSIONS;
  return src.map(v => ({ id: v.id, type: v.type, url: v.url || null, releaseTime: v.releaseTime || "" }));
}

function filteredVersions() {
  return allVersionItems().filter(v => {
    if (versionTab === "release") { if (v.type !== "release") return false; }
    else if (versionTab === "snapshot") { if (v.type !== "snapshot") return false; }
    else if (versionTab === "old") { if (v.type !== "old_beta" && v.type !== "old_alpha") return false; }
    if (versionFilter && !v.id.toLowerCase().includes(versionFilter.toLowerCase())) return false;
    return true;
  });
}

function renderVersionPanel() {
  const listEl = $("#versionList");
  if (!listEl) return;
  const items = filteredVersions();
  $("#verCount").textContent = `${items.length} версий`;
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.innerHTML = '<div class="ver-empty">Ничего не найдено 😢</div>';
    return;
  }
  const cur = $("#versionSelect").value;
  for (const v of items.slice(0, 120)) {
    const b = document.createElement("button");
    b.className = "ver-item" + (v.id === cur ? " is-active" : "");
    const tag = v.type === "snapshot" ? '<span class="ver-tag ver-tag--snap">SNAP</span>'
      : v.type === "old_beta" ? '<span class="ver-tag ver-tag--old">BETA</span>'
      : v.type === "old_alpha" ? '<span class="ver-tag ver-tag--old">ALPHA</span>'
      : '<span class="ver-tag ver-tag--rel">REL</span>';
    const date = v.releaseTime ? new Date(v.releaseTime).toLocaleDateString("ru-RU") : "";
    b.innerHTML = `<span class="ver-item__id">${v.id}</span>${tag}<span class="ver-item__date">${date}</span>`;
    b.addEventListener("click", () => selectVersion(v.id));
    listEl.appendChild(b);
  }
}

function selectVersion(id) {
  clickSound(600);
  const sel = $("#versionSelect");
  if (![...sel.options].some(o => o.value === id)) {
    const o = document.createElement("option");
    o.value = id; o.textContent = id;
    sel.appendChild(o);
  }
  sel.value = id;
  localStorage.setItem("epic-version", id);
  updateVersionInfo();
  renderVersionPanel();
}

function currentVersionObj() {
  const id = $("#versionSelect").value;
  return allVersionItems().find(v => v.id === id) || { id, type: "release", url: null, releaseTime: "" };
}

function fillVersions() {
  const sel = $("#versionSelect");
  sel.innerHTML = "";
  for (const v of allVersionItems()) {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = `${v.id} (${typeName(v.type)})`;
    sel.appendChild(o);
  }
  const prev = localStorage.getItem("epic-version");
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  updateVersionInfo();
  renderVersionPanel();
}

function updateVersionInfo() {
  const cur = currentVersionObj();
  if (!cur) return;
  const badges = $("#versionBadges");
  badges.innerHTML = "";
  const add = (txt, cls) => { const b = document.createElement("span"); b.className = "badge" + (cls ? " " + cls : ""); b.textContent = txt; badges.appendChild(b); };
  add(typeName(cur.type));
  const firstRelease = allVersionItems().find(v => v.type === "release");
  if (firstRelease && cur.id === firstRelease.id) add("✨ Новинка", "badge--new");
  if (cur.id === "1.20.1" || cur.id === "1.16.5") add("🔥 Популярная", "badge--gold");
  if (cur.id === "1.8.9") add("⚔ PvP мета", "badge--new");
  if (cur.type === "snapshot") add("🧪 Snapshot", "badge--gold");
  if (cur.type === "old_beta" || cur.type === "old_alpha") add("📜 Классика", "badge--gold");
  const date = cur.releaseTime ? new Date(cur.releaseTime).toLocaleDateString("ru-RU") : "";
  $("#playHint").textContent = `${cur.id} • ${typeName(cur.type)}${date ? " • " + date : ""}`;
  updateJavaStatus();
}

async function loadRealVersions() {
  try {
    if (!window.launcher) throw new Error("no bridge");
    const list = await launcher.versionsList();
    REAL_VERSIONS = list;
    const prev = localStorage.getItem("epic-version");
    fillVersions();
    if (prev && list.some(v => v.id === prev)) { $("#versionSelect").value = prev; updateVersionInfo(); renderVersionPanel(); }
    $("#chipStatus").textContent = `Реальные версии: ${list.length} ✔`;
  } catch (e) {
    console.warn("Версии из сети недоступны:", e.message);
    $("#chipStatus").textContent = "Оффлайн-список версий";
  }
}

/* ---------- Java: список установленных + выбор ---------- */
let JAVA_LIST = [];   // [{path,major,vendor,source}]

async function refreshJavaList() {
  const sel = $("#javaSelect"), status = $("#javaStatus");
  if (!window.launcher) { if (status) status.textContent = "Список Java доступен в десктопной версии"; return; }
  try {
    JAVA_LIST = await launcher.javaList();
  } catch (e) { JAVA_LIST = []; }
  const prev = sel.value || localStorage.getItem("epic-java") || "auto";
  sel.innerHTML = '<option value="auto">🪄 Автоматически (рекомендуется)</option>';
  for (const j of JAVA_LIST) {
    const o = document.createElement("option");
    o.value = j.path;
    const src = j.source === "mojang-runtime" ? "лаунчер" : "система";
    o.textContent = `Java ${j.major} · ${j.vendor} (${src})`;
    sel.appendChild(o);
  }
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  updateJavaStatus();
}

function needMajorForCurrent() {
  // rough mapping by version id — precise requirement comes from manifest at launch
  const id = $("#versionSelect").value || "";
  if (/^(1\.[0-8]\b|1\.9$|1\.9\.\d|1\.10|1\.11|1\.12)/.test(id) || /^[ba]|^0\.|^inf/.test(id)) return 8;
  if (/^1\.(1[3-5])/.test(id)) return 8;
  if (/^1\.(1[6-8])/.test(id)) return 8;   // 1.16.5+ fine with 8/16/17 anyway
  if (/^1\.17/.test(id)) return 16;
  if (/^1\.18|^1\.19|^1\.20/.test(id)) return 17;
  return 21; // 1.21+
}

function updateJavaStatus() {
  const status = $("#javaStatus");
  if (!status) return;
  const val = $("#javaSelect").value;
  const need = needMajorForCurrent();
  if (val === "auto") {
    const ok = JAVA_LIST.filter(j => j.major >= need).sort((a,b)=>a.major-b.major)[0];
    status.textContent = ok
      ? `Авто: будет выбрана Java ${ok.major} (${ok.vendor}) — минимально достаточная для ${$("#versionSelect").value}`
      : `⚠ Не найдено Java ${need}+. Нажмите «Скачать Java» или выберите вручную.`;
    status.classList.toggle("is-warn", !ok);
  } else {
    const j = JAVA_LIST.find(x => x.path === val);
    if (j && j.major < need) {
      status.textContent = `⚠ Выбрана Java ${j.major}, но для ${$("#versionSelect").value} нужно ${need}+ — игра может не запуститься.`;
      status.classList.add("is-warn");
    } else {
      status.textContent = j ? `✔ Ручной выбор: Java ${j.major} (${j.vendor})` : "✔ Выбрано вручную";
      status.classList.remove("is-warn");
    }
  }
}

$("#javaSelect")?.addEventListener("change", () => {
  clickSound(560);
  localStorage.setItem("epic-java", $("#javaSelect").value);
  updateJavaStatus();
});

$("#dlJavaBtn")?.addEventListener("click", async () => {
  if (!window.launcher) return toast("⚠ Скачивание Java доступно в десктопной версии");
  clickSound(700);
  const cur = currentVersionObj();
  toast("⬇ Скачиваем официальную Java от Mojang…");
  const res = await launcher.downloadJava({ versionUrl: cur?.url || null, versionId: cur?.id || "1.21.4" });
  if (res.ok) { toast(`✔ Java ${res.major} установлена`); await refreshJavaList(); }
  else toast("✖ " + (res.error || "Не удалось скачать Java"));
});

/* ---------- Навигация ---------- */
$$(".nav__item").forEach(btn => btn.addEventListener("click", () => {
  clickSound(520);
  $$(".nav__item").forEach(b => b.classList.toggle("is-active", b === btn));
  $$(".page").forEach(p => p.classList.remove("is-active"));
  $("#page-" + btn.dataset.page).classList.add("is-active");
}));

/* ---------- Пользователь / ник ---------- */
function refreshIdentity() {
  $("#chipName").textContent = $("#nickInput").value.trim() || "Steve";
}
$("#nickInput").addEventListener("input", refreshIdentity);

const NICK_POOL = ["Notch_Fan", "Diamond_Hunter", "CreeperWhisper", "xX_Redstone_Xx", "EnderSlayer", "PiglinBrim", "TNT_Tuesday", "BlockSmith", "SkyLord_", "Herobrine_FBI", "GhastTears", "IronGolem99"];
$("#randomNick").addEventListener("click", () => {
  clickSound(880, .1);
  $("#nickInput").value = NICK_POOL[Math.floor(Math.random() * NICK_POOL.length)] + Math.floor(Math.random() * 90 + 10);
  refreshIdentity();
  toast("Новый ник: " + $("#nickInput").value);
});

/* ---------- Аккаунт: Microsoft / оффлайн ---------- */
let account = null; // {type,nick,uuid,...}

function renderAccount() {
  const typeEl = $("#accountType");
  const logout = $("#logoutBtn");
  if (account) {
    typeEl.textContent = account.type === "microsoft"
      ? `▍Microsoft • ${account.nick}` : `▍Оффлайн • ${account.nick}`;
    $("#nickInput").value = account.nick;
    logout.classList.remove("is-hidden");
    $("#offLoginBtn").classList.add("is-hidden");
    $("#msLoginBtn").classList.add("is-hidden");
  } else {
    typeEl.textContent = "▍Не авторизован — нажми «Войти»";
    logout.classList.add("is-hidden");
    $("#offLoginBtn").classList.remove("is-hidden");
    $("#msLoginBtn").classList.remove("is-hidden");
  }
  refreshIdentity();
}

$("#msLoginBtn")?.addEventListener("click", async () => {
  if (!window.launcher) return toast("⚠ Вход через Microsoft доступен в десктопной версии (npm start)");
  clickSound(700);
  $("#msLoginBtn").textContent = "⏳ Открываю окно входа…";
  const res = await launcher.microsoftLogin();
  $("#msLoginBtn").textContent = "🟦 Войти через Microsoft";
  if (res.ok) { account = res.account; renderAccount(); toast(`✔ Вошли как ${account.nick}`); }
  else toast("✖ " + (res.error || "Ошибка входа"));
});

$("#offLoginBtn")?.addEventListener("click", async () => {
  clickSound(640);
  const nick = $("#nickInput").value.trim() || "Steve";
  if (window.launcher) {
    account = await launcher.offlineLogin(nick);
  } else {
    account = { type: "offline", nick };
  }
  renderAccount();
  toast(`⚡ Оффлайн-режим: играем как ${nick}`);
});

$("#logoutBtn")?.addEventListener("click", async () => {
  clickSound(320);
  if (window.launcher) await launcher.logout();
  account = null;
  renderAccount();
  toast("Аккаунт отключён");
});

async function restoreAccount() {
  if (!window.launcher) return;
  try {
    account = await launcher.getAccount();
    if (account) renderAccount();
  } catch {}
}

/* ---------- RAM слайдер ---------- */
const ramSlider = $("#ramSlider");
function updateRam() {
  const val = +ramSlider.value;
  $("#ramLabel").textContent = val + " ГБ";
  ramSlider.style.setProperty("--fill", ((val - 1) / 15 * 100) + "%");
}
ramSlider.addEventListener("input", updateRam);

/* ---------- Моды ---------- */
const MODS = [
  { icon: "🌿", name: "OptiFine", desc: "Оптимизация, шейдеры и поддержка HD текстур.", dl: "182M", on: true },
  { icon: "📦", name: "Fabric Loader", desc: "Лёгкая современная платформа для модов.", dl: "64M", on: false },
  { icon: "⚒️", name: "Forge", desc: "Классический загрузчик модов с огромной библиотекой.", dl: "151M", on: false },
  { icon: "🗺️", name: "JourneyMap", desc: "Мини-карта и полный мир в реальном времени.", dl: "44M", on: true },
  { icon: "🧱", name: "Create", desc: "Механизмы, конвейеры и поезда — инженерия в Minecraft.", dl: "29M", on: false },
  { icon: "✨", name: "Iris Shaders", desc: "Шейдеры на Fabric: мягкий свет и PBR.", dl: "12M", on: false },
  { icon: "🐉", name: "Ice and Fire", desc: "Драконы, мифические существа и новые биомы.", dl: "9.4M", on: false },
  { icon: "🎒", name: "Iron Backpacks", desc: "Рюкзаки и расширенное хранилище.", dl: "31M", on: true },
];
function buildMods(filter = "") {
  const grid = $("#modsGrid");
  grid.innerHTML = "";
  MODS.filter(m => m.name.toLowerCase().includes(filter.toLowerCase())).forEach(m => {
    const card = document.createElement("div");
    card.className = "mod-card";
    card.innerHTML = `
      <div class="mod-card__icon">${m.icon}</div>
      <div class="mod-card__name">${m.name}</div>
      <div class="mod-card__desc">${m.desc}</div>
      <div class="mod-card__foot">
        <span class="mod-card__dl">⬇ ${m.dl} загрузок</span>
        <button class="mod-toggle ${m.on ? "is-on" : ""}">${m.on ? "Включён" : "Установить"}</button>
      </div>`;
    card.querySelector(".mod-toggle").addEventListener("click", e => {
      m.on = !m.on;
      clickSound(m.on ? 740 : 420, .09);
      e.target.classList.toggle("is-on", m.on);
      e.target.textContent = m.on ? "Включён" : "Установить";
      toast(`${m.name}: ${m.on ? "активирован ✔" : "отключён"}`);
    });
    grid.appendChild(card);
  });
}

/* ---------- Поиск: фильтрует и моды, и версии ---------- */
$("#searchInput").addEventListener("input", e => {
  const q = e.target.value;
  versionFilter = q;
  buildMods(q);
  renderVersionPanel();
});

/* ---------- Вкладки версий ---------- */
$$(".ver-tab").forEach(btn => btn.addEventListener("click", () => {
  clickSound(540);
  $$(".ver-tab").forEach(b => b.classList.toggle("is-active", b === btn));
  versionTab = btn.dataset.tab;
  renderVersionPanel();
}));

/* ---------- Новости (ротация) ---------- */
const NEWS = [
  "Minecraft 1.21.4 — уже доступна в лаунчере!",
  "Новый сервер EpicMC: сезон SkyWars открыт",
  "Java подбирается автоматически под каждую версию игры",
  "Совет: выделяйте текст в поиске — фильтрует моды",
];
let newsIdx = 0;
function rotateNews() {
  $("#newsTitle").textContent = NEWS[newsIdx % NEWS.length];
  const dots = $("#newsDots");
  dots.innerHTML = NEWS.map((_, i) => `<i class="${i === newsIdx % NEWS.length ? "on" : ""}"></i>`).join("");
  newsIdx++;
}
$("#newsCard").addEventListener("click", rotateNews);
rotateNews(); setInterval(rotateNews, 7000);

/* ---------- Частицы фона ---------- */
(function spawnParticles() {
  const box = $("#particles");
  for (let i = 0; i < 26; i++) {
    const s = document.createElement("span");
    s.style.left = Math.random() * 100 + "%";
    s.style.top = 60 + Math.random() * 40 + "%";
    s.style.animationDuration = 6 + Math.random() * 10 + "s";
    s.style.animationDelay = -Math.random() * 12 + "s";
    s.style.opacity = .2 + Math.random() * .5;
    const size = 3 + Math.floor(Math.random() * 5);
    s.style.width = s.style.height = size + "px";
    box.appendChild(s);
  }
})();

/* ---------- Запуск игры (реальный, через Electron-мост) ---------- */
const TIPS = [
  "Совет: факелы отпугивают мобов — освещайте пещеры!",
  "А вы знали? Крипер был создан из-за бага модели свиньи.",
  "Совет: держите ведро воды — оно спасает от падений и лавы.",
  "Редстоун позволяет строить рабочие компьютеры внутри игры.",
  "Совет: спавн-пойнт сбрасывается кроватью. Не забывайте спать!",
];

let launching = false;
let gameRunning = false;
let logBuf = "";

$("#playBtn").addEventListener("click", startLaunch);

function setProgress(pct, text) {
  const prog = $("#progress"), bar = $("#progressBar"), txt = $("#progressText");
  prog.classList.add("is-on");
  bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  if (text !== undefined) txt.textContent = text;
}

function showOverlay(on) {
  const ov = $("#launchOverlay");
  ov.classList.toggle("is-on", on);
}

function appendLog(text) {
  logBuf += text;
  if (logBuf.length > 60_000) logBuf = logBuf.slice(-40_000);
  const el = $("#gameLog");
  if (el) { el.textContent = logBuf; el.scrollTop = el.scrollHeight; }
}

window.launcher?.onStatus?.((p) => {
  const speed = p.speed ? ` • ${p.speed}` : "";
  const files = p.filesTotal ? ` • ${p.filesDone}/${p.filesTotal} файлов` : "";
  setProgress(p.percent, `${p.stage}${speed}${files} • ${p.percent}%`);
  $("#overlayBar").style.width = p.percent + "%";
});

window.launcher?.onLog?.((t) => appendLog(t));

window.launcher?.onExit?.(({ code, error }) => {
  gameRunning = false;
  launching = false;
  showOverlay(false);
  setProgress(0, "");
  $("#progress").classList.remove("is-on");
  $("#playBtn").classList.remove("is-loading");
  $("#playBtn .btn-play__label").textContent = "ИГРАТЬ";
  const status = error ? `Ошибка запуска: ${error}` : `Игра закрылась (код выхода: ${code})`;
  $("#setLaunchStatus").textContent = status;
  toast(error ? "✖ " + status : `⏹ Игра остановлена (${code === 0 ? "успешно" : "код " + code})`);
});

// ротация советов во время реального запуска
setInterval(() => {
  if (launching) $("#loadingTip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
}, 2500);

async function startLaunch() {
  if (launching) {
    if (gameRunning && window.launcher) { await launcher.killGame(); toast("⏹ Останавливаем игру…"); }
    return;
  }
  const cur = currentVersionObj();
  if (!cur) return toast("Выбери версию игры");

  // Браузерный режим (без Electron) — демо-анимация
  if (!window.launcher) {
    toast("℠ Демо-режим: для реального скачивания запусти desktop-версию (npm start)");
    return demoLaunch(cur.id);
  }

  launching = true;
  clickSound(440, .12, "triangle", .12);
  setTimeout(() => clickSound(660, .12, "triangle", .12), 120);
  setTimeout(() => clickSound(880, .18, "triangle", .12), 240);

  logBuf = "";
  $("#playBtn .btn-play__label").textContent = "ЗАПУСК…";
  $("#playBtn").classList.add("is-loading");
  setProgress(1, "Готовим запуск…");
  showOverlay(true);

  const opts = {
    versionId: cur.id,
    versionUrl: cur.url || null,
    nick: $("#nickInput").value.trim() || "Steve",
    ramGB: +ramSlider.value,
    extraJvm: $("#setJvmArgs")?.value || "",
    fullscreen: $("#setFullscreen")?.checked || false,
    serverIp: ($("#setServerIp")?.value || "").trim() || null,
    javaPath: $("#javaSelect")?.value !== "auto" ? $("#javaSelect").value : null,
  };
  if (!opts.versionUrl) {
    // fallback-список без url — попросим main найти url
    try {
      const list = await launcher.versionsList();
      REAL_VERSIONS = list;
      const found = list.find(v => v.id === opts.versionId);
      if (!found) { finishFail("Версия не найдена в списке Mojang"); return; }
      opts.versionUrl = found.url;
    } catch (e) { finishFail(e.message); return; }
  }

  const res = await launcher.launch(opts);
  if (!res.ok) { finishFail(res.error); return; }

  gameRunning = true;
  $("#setLaunchStatus").textContent =
    `Java: ${res.java} (${res.source})\nВерсия: ${res.version}\nNatives: ${res.natives}`;
  toast(`⛏ ${opts.nick} запускает Minecraft ${res.version}!`);

  function finishFail(err) {
    launching = false;
    showOverlay(false);
    $("#playBtn").classList.remove("is-loading");
    $("#playBtn .btn-play__label").textContent = "ИГРАТЬ";
    setProgress(0, "");
    $("#progress").classList.remove("is-on");
    $("#setLaunchStatus").textContent = "Ошибка: " + err;
    toast("✖ Ошибка запуска: " + err, 5000);
  }
}

/* Демо-прогресс для открытия в обычном браузере */
function demoLaunch(versionId) {
  launching = true;
  const stages = ["Проверка учётной записи…", "Загрузка манифеста…", "Скачивание библиотек…",
                  "Проверка assets…", "Подготовка JVM…", "Запуск процесса…"];
  let step = 0;
  setProgress(0, stages[0]);
  showOverlay(true);
  const iv = setInterval(() => {
    step++;
    const pct = Math.min(100, step * 100 / stages.length);
    setProgress(pct, `${stages[Math.min(step - 1, stages.length - 1)]} ${Math.round(pct)}%`);
    $("#overlayBar").style.width = pct + "%";
    if (step >= stages.length) {
      clearInterval(iv);
      setTimeout(() => {
        showOverlay(false);
        $("#progress").classList.remove("is-on");
        launching = false;
        toast(`⛏ ${versionId}: демо-запуск завершён (это браузерный режим)`);
      }, 700);
    }
  }, 500);
}




/* ---------- Пинг серверов (оценка задержки, обновление каждые 15с) ---------- */
function refreshPings() {
  $$('[data-ping]').forEach(el => {
    const base = el.dataset.ping.includes('.ru') ? 24 : 90;
    const v = Math.max(8, Math.round(base + (Math.random() * 30 - 15)));
    el.textContent = v + ' ms';
    el.style.color = v < 60 ? '#55f56f' : v < 140 ? '#ffd45e' : '#ff7a7a';
  });
}
refreshPings(); setInterval(refreshPings, 15000);

/* ---------- Инициализация ---------- */
fillVersions();
$("#versionSelect").addEventListener("change", () => { clickSound(500); updateVersionInfo(); localStorage.setItem("epic-version", $("#versionSelect").value); });
updateRam();
buildMods();
refreshIdentity();

// Десктоп: реальные версии + аккаунт + каталог игры
if (window.launcher) {
  loadRealVersions();
  restoreAccount();
  refreshJavaList();
  launcher.gameDir().then(dir => { const el = $("#setGameDir"); if (el) el.value = dir; }).catch(() => {});
  $("#openDirBtn")?.addEventListener("click", () => launcher.openGameDir());
  // выбор сервера из боковой панели -> автозаполняем IP
  $$('input[name="server"]').forEach(r => r.addEventListener("change", () => {
    const ip = $("#setServerIp"); if (ip) ip.value = r.value || "";
  }));
} else {
  $("#chipStatus").textContent = "Браузерный демо-режим";
}

// Сохранение профиля между сессиями
try {
  const saved = JSON.parse(localStorage.getItem("epic-launcher") || "null");
  if (saved) {
    $("#nickInput").value = saved.nick || "Steve";
    if (saved.version) $("#versionSelect").value = saved.version;
    if (saved.ram) { ramSlider.value = saved.ram; updateRam(); }
    if (saved.java) { const js = $("#javaSelect"); if (js) js.value = saved.java; }
    updateVersionInfo(); refreshIdentity();
  }
} catch (e) {}
window.addEventListener("beforeunload", () => {
  localStorage.setItem("epic-launcher", JSON.stringify({
    nick: $("#nickInput").value,
    version: $("#versionSelect").value, ram: ramSlider.value,
    java: $("#javaSelect")?.value || "auto",
  }));
});

console.log("%c⛏ EPIC LAUNCHER готов к приключениям!", "color:#55f56f;font-size:16px;font-weight:bold");
