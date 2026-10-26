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

/* ---------- Пиксельный аватар по нику (как face.pp) ---------- */
function drawPixelAvatar(canvas, name, skin) {
  const ctx = canvas.getContext("2d");
  const S = canvas.width / 8; // 8x8 пикселей
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Детерминированный рандом от ника
  let seed = 0;
  for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

  const pal = skin ? skin.palette : ["#4f4f4f", "#8d6a4f", "#b58762", "#3f2d1e"];
  const base = pal[Math.floor(rnd() * pal.length)];
  const hair = pal[Math.floor(rnd() * pal.length)];
  const eye  = ["#3b4ffc", "#7b4fd8", "#2ea043", "#8d6a4f"][Math.floor(rnd() * 4)];

  const grid = [];
  for (let y = 0; y < 8; y++) { grid[y] = []; for (let x = 0; x < 4; x++) grid[y][x] = null; }

  // Волосы: верх + бока
  for (let x = 0; x < 4; x++) { grid[0][x] = hair; if (rnd() > .3) grid[1][x] = hair; }
  // Лицо
  for (let y = 2; y < 7; y++) for (let x = 0; x < 4; x++) if (!grid[y][x]) grid[y][x] = base;
  // Глаза (строка 4, колонки 1..2)
  grid[4][1] = "#fff"; grid[4][2] = "#fff";
  // Рот
  grid[5][1] = shade(base, -30); grid[5][2] = shade(base, -30);
  // Симметрия
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) grid[y][7 - x] = grid[y][x];
  // Зрачки (несимметрично)
  grid[4][2] = eye; grid[4][5] = eye;

  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = grid[y][x] || shade(base, -15);
      ctx.fillRect(x * S, y * S, S + .5, S + .5);
    }
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

/* ---------- Скин-персонаж (изометрия на canvas) ---------- */
const SKINS = [
  { id: "steve",  name: "Steve — Классический", palette: ["#00afaf", "#4c3222", "#d58162", "#8d6a4f"], shirt: "#00a8a8", pants: "#3f4c8d", head: "#b58762" },
  { id: "alex",   name: "Alex — Разведчица",    palette: ["#ff9d3b", "#3f2d1e", "#c68a5b", "#6fbf3e"], shirt: "#6fbf3e", pants: "#8d6a4f", head: "#c68a5b" },
  { id: "knight", name: "Рыцарь Нижнего мира",  palette: ["#2b2b2b", "#5c1f1f", "#8a8a8a", "#cfcfcf"], shirt: "#3b3b3b", pants: "#242424", head: "#8a8a8a" },
  { id: "herobrine", name: "Геробрин (легенда)", palette: ["#ffffff", "#c9c9c9", "#b58762", "#3b4ffc"], shirt: "#dcdcdc", pants: "#9aa7c4", head: "#b58762", glowEyes: true },
  { id: "zombie", name: "Зомби-стиль",           palette: ["#2ea043", "#1c7030", "#3f4c8d", "#5fae5f"], shirt: "#3d7a3d", pants: "#2d3a66", head: "#5fae5f" },
  { id: "notch",  name: "Нотч — Создатель",      palette: ["#e8e8e8", "#4c3222", "#d58162", "#9a9a9a"], shirt: "#f2f2f2", pants: "#3a3a3a", head: "#d58162" },
];

function drawCharacter(canvas, skin, big) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const u = big ? W / 22 : W / 16;          // «пиксель»
  ctx.clearRect(0, 0, W, H);

  const px = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h)); };

  const cx = W / 2;
  const headW = u * 8, bodyW = u * 8, legW = u * 8;
  const headY = H * 0.10, bodyY = headY + headW * 1.25, legY = bodyY + u * 12;

  // Тень
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath(); ctx.ellipse(cx, legY + u * 14, u * 7, u * 1.6, 0, 0, 7); ctx.fill();

  // Ноги
  px(cx - legW / 2, legY, u * 3.6, u * 12, skin.pants);
  px(cx + u * 0.4, legY, u * 3.6, u * 12, shade(skin.pants, -18));
  // Торс
  px(cx - bodyW / 2, bodyY, bodyW, u * 12, skin.shirt);
  px(cx - bodyW / 2, bodyY, bodyW, u * 2, shade(skin.shirt, 18));
  // Руки
  px(cx - bodyW / 2 - u * 4, bodyY + u, u * 3.6, u * 11, shade(skin.shirt, -25));
  px(cx + bodyW / 2 + u * 0.4, bodyY + u, u * 3.6, u * 11, skin.head);
  // Голова
  px(cx - headW / 2, headY, headW, headW, skin.head);
  px(cx - headW / 2, headY, headW, u * 2.4, shade(skin.head, -35)); // чёлка
  // Глаза
  const eyeC = skin.glowEyes ? "#ffffff" : "#3b4ffc";
  px(cx - u * 2.6, headY + u * 4.2, u * 1.4, u * 1.4, "#fff");
  px(cx + u * 1.2, headY + u * 4.2, u * 1.4, u * 1.4, "#fff");
  px(cx - u * 2.2, headY + u * 4.2, u * 0.8, u * 1.4, eyeC);
  px(cx + u * 1.8, headY + u * 4.2, u * 0.8, u * 1.4, eyeC);
  if (skin.glowEyes) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 12; px(cx - u * 2.2, headY + u * 4.2, u * 0.8, u * 1.4, "#fff"); ctx.shadowBlur = 0; }
  // Рот
  px(cx - u * 1.4, headY + u * 7, u * 2.8, u * 0.9, shade(skin.head, -45));
}

/* ---------- Версии игры (реальный список piston-meta) ---------- */
let REAL_VERSIONS = [];           // [{id,type,url,releaseTime}]
const FALLBACK_VERSIONS = [
  { v: "1.21.4", type: "Release" }, { v: "1.20.1", type: "Release" },
  { v: "1.16.5", type: "Release" }, { v: "1.12.2", type: "Release" },
  { v: "1.8.9", type: "Release" },
];

function tagFor(vr) {
  if (vr.type === "snapshot") return ["snapshot"];
  if (vr.id === "1.20.1") return ["popular"];
  if (vr.id === "1.8.9") return ["pvp"];
  if (/^(Beta|Alpha)/.test(vr.type)) return ["classic"];
  return [];
}

function fillVersions() {
  const sel = $("#versionSelect");
  sel.innerHTML = "";
  const addGroup = (label, items) => {
    if (!items.length) return;
    const g = document.createElement("optgroup");
    g.label = label;
    items.forEach(vr => {
      const o = document.createElement("option");
      o.value = vr.id || vr.v;
      o.textContent = `${vr.id || vr.v} (${vr.type})`;
      g.appendChild(o);
    });
    sel.appendChild(g);
  };
  if (REAL_VERSIONS.length) {
    const rel = REAL_VERSIONS.filter(v => v.type === "release").slice(0, 30);
    const snap = REAL_VERSIONS.filter(v => v.type === "snapshot").slice(0, 10);
    const old = REAL_VERSIONS.filter(v => v.type === "old_beta" || v.type === "old_alpha").slice(0, 12);
    addGroup("Релизы", rel);
    addGroup("Снапшоты", snap);
    addGroup("Beta / Alpha", old);
  } else {
    addGroup("Версии", FALLBACK_VERSIONS.map(f => ({ id: f.v, type: f.type })));
  }
  updateVersionInfo();
}

function currentVersionObj() {
  const id = $("#versionSelect").value;
  if (REAL_VERSIONS.length) return REAL_VERSIONS.find(v => v.id === id) || null;
  const fb = FALLBACK_VERSIONS.find(f => f.v === id) || FALLBACK_VERSIONS[0];
  return { id: fb.v, type: fb.type, url: null, releaseTime: "" };
}

function typeName(t) {
  return { release: "Release", snapshot: "Snapshot", old_beta: "Beta", old_alpha: "Alpha" }[t] || t;
}

function updateVersionInfo() {
  const cur = currentVersionObj();
  if (!cur) return;
  const badges = $("#versionBadges");
  badges.innerHTML = "";
  const add = (txt, cls) => { const b = document.createElement("span"); b.className = "badge" + (cls ? " " + cls : ""); b.textContent = txt; badges.appendChild(b); };
  const tags = tagFor(cur);
  add(typeName(cur.type));
  if (cur.id === REAL_VERSIONS.find(v => v.type === "release")?.id) add("✨ Новинка", "badge--new");
  if (tags.includes("popular")) add("🔥 Популярная", "badge--gold");
  if (tags.includes("classic")) add("📜 Классика", "badge--gold");
  if (tags.includes("pvp")) add("⚔ PvP мета", "badge--new");
  if (tags.includes("snapshot")) add("🧪 Snapshot", "badge--gold");
  const date = cur.releaseTime ? new Date(cur.releaseTime).toLocaleDateString("ru-RU") : "";
  $("#playHint").textContent = `${cur.id} • ${typeName(cur.type)}${date ? " • " + date : ""}`;
}

async function loadRealVersions() {
  try {
    if (!window.launcher) throw new Error("no bridge");
    const list = await launcher.versionsList();
    REAL_VERSIONS = list;
    const prev = localStorage.getItem("epic-version");
    fillVersions();
    if (prev && list.some(v => v.id === prev)) { $("#versionSelect").value = prev; updateVersionInfo(); }
    $("#chipStatus").textContent = `Реальные версии: ${list.length} ✔`;
  } catch (e) {
    console.warn("Версии из сети недоступны:", e.message);
    $("#chipStatus").textContent = "Оффлайн-список версий";
  }
}

/* ---------- Навигация ---------- */
$$(".nav__item").forEach(btn => btn.addEventListener("click", () => {
  clickSound(520);
  $$(".nav__item").forEach(b => b.classList.toggle("is-active", b === btn));
  $$(".page").forEach(p => p.classList.remove("is-active"));
  $("#page-" + btn.dataset.page).classList.add("is-active");
}));

/* ---------- Пользователь / ник ---------- */
let currentSkin = SKINS[0];
function refreshIdentity() {
  const nick = ($("#nickInput").value.trim() || "Steve");
  $("#chipName").textContent = nick;
  drawPixelAvatar($("#avatarCanvas"), nick, currentSkin);
  drawPixelAvatar($("#avatarBig"), nick, currentSkin);
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

/* ---------- Скины ---------- */
function buildSkinList() {
  const list = $("#skinList");
  list.innerHTML = "";
  SKINS.forEach(sk => {
    const tile = document.createElement("button");
    tile.className = "skin-tile" + (sk.id === currentSkin.id ? " is-selected" : "");
    const cv = document.createElement("canvas");
    cv.width = 144; cv.height = 192;
    tile.appendChild(cv);
    const lbl = document.createElement("div");
    lbl.className = "skin-tile__label";
    lbl.textContent = sk.name.split("—")[0].trim();
    tile.appendChild(lbl);
    tile.addEventListener("click", () => {
      clickSound(660, .09);
      currentSkin = sk;
      $("#skinName").textContent = sk.name;
      drawCharacter($("#skinCanvas"), sk, true);
      buildSkinList();
      refreshIdentity();
      toast(`Скин «${sk.name}» применён ✔`);
    });
    list.appendChild(tile);
    drawCharacter(cv, sk, false);
  });
}

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

/* ---------- Поиск ---------- */
$("#searchInput").addEventListener("input", e => {
  const q = e.target.value;
  buildMods(q);
  $$(".skin-tile").forEach((t, i) => {
    t.style.display = SKINS[i].name.toLowerCase().includes(q.toLowerCase()) || !q ? "" : "none";
  });
});

/* ---------- Новости (ротация) ---------- */
const NEWS = [
  "Minecraft 1.21.4 — уже доступна в лаунчере!",
  "Новый сервер EpicMC: сезон SkyWars открыт",
  "Наборы скинов «Глубины» уже в галерее",
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
  const h = $("#statHours"); h.textContent = +h.textContent + 1;

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

/* ---------- Живой онлайн ---------- */
setInterval(() => {
  const el = $("#statOnline");
  const base = 1.2 + Math.random() * 0.15;
  el.textContent = base.toFixed(1) + "M";
}, 5000);

/* ---------- Инициализация ---------- */
fillVersions();
$("#versionSelect").addEventListener("change", () => { clickSound(500); updateVersionInfo(); localStorage.setItem("epic-version", $("#versionSelect").value); });
updateRam();
buildSkinList();
buildMods();
refreshIdentity();
drawCharacter($("#skinCanvas"), currentSkin, true);

// Десктоп: реальные версии + аккаунт + каталог игры
if (window.launcher) {
  loadRealVersions();
  restoreAccount();
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
    if (saved.skin) currentSkin = SKINS.find(s => s.id === saved.skin) || currentSkin;
    if (saved.version) $("#versionSelect").value = saved.version;
    if (saved.ram) { ramSlider.value = saved.ram; updateRam(); }
    updateVersionInfo(); buildSkinList(); refreshIdentity();
    drawCharacter($("#skinCanvas"), currentSkin, true);
    $("#skinName").textContent = currentSkin.name;
  }
} catch (e) {}
window.addEventListener("beforeunload", () => {
  localStorage.setItem("epic-launcher", JSON.stringify({
    nick: $("#nickInput").value, skin: currentSkin.id,
    version: $("#versionSelect").value, ram: ramSlider.value,
  }));
});

console.log("%c⛏ EPIC LAUNCHER готов к приключениям!", "color:#55f56f;font-size:16px;font-weight:bold");
