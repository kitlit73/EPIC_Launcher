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
let INSTALLED = [];               // id установленных версий
const FALLBACK_VERSIONS = [
  { id: "1.21.4", type: "release" }, { id: "1.20.1", type: "release" },
  { id: "1.16.5", type: "release" }, { id: "1.12.2", type: "release" },
  { id: "1.8.9", type: "release" },
];
let versionFilter = "";           // строка поиска
let versionTab = "all";           // all | release | snapshot | old

function typeName(t) {
  return { release: "Релиз", snapshot: "Снапшот", old_beta: "Бета", old_alpha: "Альфа" }[t] || t;
}

function allVersionItems() {
  const src = REAL_VERSIONS.length ? REAL_VERSIONS : FALLBACK_VERSIONS;
  const items = src.map(v => ({ id: v.id, type: v.type, url: v.url || null, releaseTime: v.releaseTime || "" }));
  // Загрузчики Fabric/Forge больше не показываются как отдельные версии в списке —
  // они выбираются переключателем рядом с кнопкой «Играть».
  // Сортировка: релизы (новые сначала), затем снапшоты и старые версии. Манифест
  // piston-meta идёт от новых снапшотов вниз, из-за чего в панели (первые 120
  // записей) не видно ни 1.21.4, ни 1.20.1 и т.д. — сортируем, чтобы релизы
  // попали в видимую часть.
  const rank = { release: 0, snapshot: 1, old_beta: 2, old_alpha: 3 };
  return [...items].sort((a, b) => {
    const ra = rank[a.type] ?? 9, rb = rank[b.type] ?? 9;
    if (ra !== rb) return ra - rb;
    return (b.releaseTime || "").localeCompare(a.releaseTime || "");
  });
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
    const isInst = INSTALLED.includes(v.id);
    b.className = "ver-item" + (v.id === cur ? " is-active" : "") + (isInst ? " is-installed" : "");
    const tag = v.type === "snapshot" ? '<span class="ver-tag ver-tag--snap">SNAP</span>'
      : v.type === "old_beta" ? '<span class="ver-tag ver-tag--old">BETA</span>'
      : v.type === "old_alpha" ? '<span class="ver-tag ver-tag--old">ALPHA</span>'
      : v.loader === "fabric" ? '<span class="ver-tag ver-tag--fabric">FABRIC</span>'
      : v.loader === "forge" ? '<span class="ver-tag ver-tag--forge">FORGE</span>'
      : '<span class="ver-tag ver-tag--rel">REL</span>';
    const instMark = isInst ? '<span class="ver-tag ver-tag--inst">✔ Установлена</span>' : "";
    const date = v.releaseTime ? new Date(v.releaseTime).toLocaleDateString("ru-RU") : "";
    b.innerHTML = `<span class="ver-item__id">${v.id}</span>${tag}${instMark}<span class="ver-item__date">${date}</span>`;
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
  const firstRelease = allVersionItems().find(v => v.type === "release" && !v.loader);
  if (firstRelease && cur.id === firstRelease.id) add("✨ Новинка", "badge--new");
  if (cur.id === "1.20.1" || cur.id === "1.16.5") add("🔥 Популярная", "badge--gold");
  if (cur.id === "1.8.9") add("⚔ PvP мета", "badge--new");
  if (cur.type === "snapshot") add("🧪 Snapshot", "badge--gold");
  if (cur.type === "old_beta" || cur.type === "old_alpha") add("📜 Классика", "badge--gold");
  const date = cur.releaseTime ? new Date(cur.releaseTime).toLocaleDateString("ru-RU") : "";
  const loaderTxt = launchLoader === "fabric" ? " • Fabric" : launchLoader === "forge" ? " • Forge" : "";
  $("#playHint").textContent = `${cur.id} • ${typeName(cur.type)}${loaderTxt}${date ? " • " + date : ""}`;
  updateJavaStatus();
}

async function loadRealVersions() {
  const t = performance.now();
  try {
    if (!window.launcher) throw new Error("no bridge");
    const list = await launcher.versionsList();
    console.log("[timing] loadRealVersions:", Math.round(performance.now() - t), "ms");
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

async function loadInstalledVersions() {
  if (!window.launcher) return;
  try {
    INSTALLED = await launcher.installedVersions();
    renderVersionPanel();
  } catch {}
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
  clickSound(700);
  openJavaDialog();
});

$("#instMenuJavaDl")?.addEventListener("click", () => { clickSound(700); openJavaDialog(); });

/* ---------- Диалог «Скачать Java» (выбор рантайма) ---------- */
let javaRuntimes = [];

function openJavaDialog() {
  const dlg = $("#javaDialog");
  if (!dlg) return;
  dlg.classList.remove("is-hidden");
  $("#javaStatusLine").textContent = "Загружаем список рантаймов…";
  loadJavaRuntimes();
}

function closeJavaDialog() { $("#javaDialog")?.classList.add("is-hidden"); }

$("#javaDialogClose")?.addEventListener("click", () => { clickSound(500); closeJavaDialog(); });
$("#javaDialog")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeJavaDialog(); });

async function loadJavaRuntimes() {
  if (!window.launcher) return;
  try {
    const res = await launcher.javaAvailable();
    if (!res.ok) { $("#javaStatusLine").textContent = "✖ " + (res.error || "Ошибка"); return; }
    javaRuntimes = res.runtimes || [];
    const list = $("#javaRuntimeList");
    list.innerHTML = "";
    if (!javaRuntimes.length) { list.innerHTML = '<div class="ver-empty">Рантаймы не найдены — проверьте интернет.</div>'; return; }
    for (const rt of javaRuntimes) {
      const card = document.createElement("div");
      card.className = "mod-card java-runtime-card";
      const inst = rt.installed
        ? '<span class="mod-card__dl">✔ Уже установлена</span>'
        : '<span class="mod-card__dl">' + esc(rt.vendor) + "</span>";
      const action = rt.installed
        ? '<button class="mod-toggle is-on" data-jd disabled>✔ Установлена</button><button class="mod-toggle" data-jdel title="Удалить рантайм с диска">🗑 Удалить</button>'
        : '<button class="mod-toggle" data-jd>⬇ Скачать</button>';
      card.innerHTML = `
        <div class="mod-card__icon">☕</div>
        <div class="mod-card__name">Java ${esc(String(rt.major ?? "?"))}</div>
        <div class="mod-card__desc">${esc(rt.version)} • ${esc(rt.component)}</div>
        <div class="mod-card__foot">
          ${inst}
          ${action}
        </div>`;
      card.querySelector("[data-jd]").addEventListener("click", async e => {
        if (rt.installed) return;
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "⏳ …";
        clickSound(700);
        const prog = $("#javaBar");
        if (prog) prog.style.width = "0%";
        $("#javaStatusLine").textContent = `Скачиваем Java ${rt.version}…`;
        const res = await launcher.downloadJava({ component: rt.component });
        if (res.ok) {
          $("#javaStatusLine").textContent = `✔ Java ${res.major} (${rt.component}) установлена`;
          if (prog) prog.style.width = "100%";
          toast(`✔ Java ${res.major} установлена`);
          await refreshJavaList();
          await loadJavaRuntimes();
          if (menuInstance) fillInstMenuJava(menuInstance);
        } else {
          btn.disabled = false;
          btn.textContent = "⬇ Скачать";
          $("#javaStatusLine").textContent = "✖ " + (res.error || "Ошибка") + " — попробуйте ещё раз";
          toast("✖ " + (res.error || "Не удалось скачать Java"), 5000);
        }
      });
      card.querySelector("[data-jdel]")?.addEventListener("click", async e => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "⏳ …";
        clickSound(500);
        const res = await launcher.deleteJava({ component: rt.component });
        if (res.ok) {
          $("#javaStatusLine").textContent = `🗑 Java ${rt.version} (${rt.component}) удалена`;
          toast(`🗑 Java ${rt.version} удалена`);
          await refreshJavaList();
          await loadJavaRuntimes();
          if (menuInstance) fillInstMenuJava(menuInstance);
        } else {
          btn.disabled = false;
          btn.textContent = "🗑 Удалить";
          toast("✖ " + (res.error || "Не удалось удалить"), 5000);
        }
      });
      list.appendChild(card);
    }
    $("#javaStatusLine").textContent = "Выберите версию и нажмите «Скачать».";
  } catch (e) {
    $("#javaStatusLine").textContent = "✖ " + (e.message || "Ошибка");
  }
}

/* ---------- Навигация ---------- */
$$(".nav__item").forEach(btn => btn.addEventListener("click", () => {
  clickSound(520);
  if (btn.dataset.page !== "mods") { activeModsInstance = null; closeInstanceMods(); }
  $$(".nav__item").forEach(b => b.classList.toggle("is-active", b === btn));
  $$(".page").forEach(p => p.classList.remove("is-active"));
  $("#page-" + btn.dataset.page).classList.add("is-active");
}));

/* ---------- Режимы: Простой / Продвинутый ---------- */
let appMode = localStorage.getItem("epic-mode") || "simple"; // simple | advanced
function setMode(mode, { silent } = {}) {
  appMode = mode === "advanced" ? "advanced" : "simple";
  localStorage.setItem("epic-mode", appMode);
  document.body.classList.toggle("mode-simple", appMode === "simple");
  $$(".mode-switch").forEach(sw => {
    sw.querySelectorAll(".mode-switch__btn").forEach(b => b.classList.toggle("is-active", b.dataset.mode === appMode));
  });
  if (appMode === "simple") {
    $$(".nav__item").forEach(b => b.classList.toggle("is-active", b.dataset.page === "home"));
    $$(".page").forEach(p => p.classList.toggle("is-active", p.id === "page-home"));
  } else {
    refreshInstances();
  }
  if (!silent) toast(appMode === "advanced" ? "Продвинутый режим: управление сборками на «Главной»" : "Простой режим: единая версия");
}
function bindModeSwitches() {
  $$(".mode-switch").forEach(sw => sw.querySelectorAll(".mode-switch__btn").forEach(b => {
    b.addEventListener("click", () => { clickSound(560); setMode(b.dataset.mode); });
  }));
}

/* ---------- Тема и фон ---------- */
function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme || "lava");
  localStorage.setItem("epic-theme", theme || "lava");
  $$("#themePicker .theme-opt").forEach(o => o.classList.toggle("is-active", o.dataset.theme === (theme || "lava")));
}
function applyBg(bg) {
  document.body.setAttribute("data-bg", bg || "lava");
  localStorage.setItem("epic-bg", bg || "lava");
  $$("#bgPicker .theme-opt").forEach(o => o.classList.toggle("is-active", o.dataset.bg === (bg || "lava")));
}
function bindThemePickers() {
  $$("#themePicker .theme-opt").forEach(o => o.addEventListener("click", () => { clickSound(560); applyTheme(o.dataset.theme); }));
  $$("#bgPicker .theme-opt").forEach(o => o.addEventListener("click", () => { clickSound(560); applyBg(o.dataset.bg); }));
}
applyTheme(localStorage.getItem("epic-theme") || "lava");
applyBg(localStorage.getItem("epic-bg") || "lava");
bindThemePickers();

/* ---------- Сборки (instances) ---------- */
let INSTANCES = [];
let selectedInstance = null;
let dlgLoader = "vanilla", dlgIcon = "⛏";

function loaderName(loader) {
  return { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt", vanilla: "Vanilla" }[loader] || "Vanilla";
}

function pick(loader) {
  return { fabric: "fabric", forge: "forge", neoforge: "neoforge", quilt: "quilt", vanilla: "vanilla" }[loader] || "vanilla";
}

/* ---------- Диалог создания/настройки сборки ---------- */
$("#instanceDlgClose")?.addEventListener("click", closeInstanceDialog);
$("#instanceDialog")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeInstanceDialog(); });
$$(".inst-icon").forEach(i => i.addEventListener("click", () => {
  dlgIcon = i.dataset.icon;
  $$(".inst-icon").forEach(x => x.classList.toggle("is-active", x === i));
}));
$$(".inst-loader").forEach(l => l.addEventListener("click", () => {
  dlgLoader = l.dataset.loader;
  $$(".inst-loader").forEach(x => x.classList.toggle("is-active", x === l));
  $("#instLoadersHint").textContent = dlgLoader === "vanilla"
    ? "Чистая ванильная версия без загрузчиков."
    : `${loaderName(dlgLoader)} будет автоматически установлен для выбранной версии.`;
}));
$("#homeNewInstanceBtn")?.addEventListener("click", () => { clickSound(640); openInstanceDialog(null); });
$("#instanceDlgSave")?.addEventListener("click", saveInstanceDialog);
$("#instRamSlider")?.addEventListener("input", updateInstRam);

async function saveInstanceDialog() {
  if (!window.launcher) return toast("⚠ Доступно в десктопной версии");
  const dlg = $("#instanceDialog");
  const editId = dlg.dataset.editId;
  const name = $("#instName").value.trim();
  if (!name) return toast("Введите название сборки");
  const version = $("#instVersionSelect").value;
  const ramGB = +$("#instRamSlider").value;
  const statusEl = $("#instanceDlgStatus");
  if (editId) {
    statusEl.textContent = "Сохраняем…";
    const res = await launcher.instanceUpdate({ id: editId, name, icon: dlgIcon, ramGB });
    if (res.ok) { toast("✔ Сборка обновлена"); closeInstanceDialog(); refreshInstances(); }
    else { statusEl.textContent = "✖ " + (res.error || "Ошибка"); toast("✖ " + (res.error || "Ошибка")); }
    return;
  }
  statusEl.textContent = "Создаём сборку…";
  const res = await launcher.instanceCreate({ name, mcVersion: version, loader: dlgLoader, icon: dlgIcon, ramGB });
  if (!res.ok) { statusEl.textContent = "✖ " + (res.error || "Ошибка"); return; }
  const inst = res.instance;
  if (dlgLoader !== "vanilla") {
    statusEl.textContent = `Устанавливаем ${loaderName(dlgLoader)} ${version}…`;
    const lr = await launcher.installLoader({ kind: dlgLoader, gameVersion: version, instanceId: inst.id });
    if (!lr.ok) toast("⚠ Сборка создана, но загрузчик не установился: " + lr.error);
  }
  closeInstanceDialog();
  selectedInstance = inst.id;
  await refreshInstances();
  toast(`✔ Сборка «${name}» создана`);
}

async function launchInstance(inst) {
  if (!window.launcher) return toast("⚠ Доступно в десктопной версии");
  let fresh = inst;
  try {
    const list = await launcher.instancesList();
    fresh = list.find(x => x.id === inst.id) || inst;
  } catch {}
  selectedInstance = fresh.id;
  startLaunch({ instance: fresh });
}

/* ---------- Панель деталей сборки (продвинутый режим) ---------- */
$("#homeInstPlay")?.addEventListener("click", () => {
  const inst = window.__activeInstForMenu;
  if (inst) launchInstance(inst);
});
$("#homeInstSettings")?.addEventListener("click", () => {
  const inst = window.__activeInstForMenu;
  if (inst) openInstanceMenu(inst);
});
$("#homeInstOpenDir")?.addEventListener("click", () => {
  const inst = window.__activeInstForMenu;
  if (inst && window.launcher) launcher.openGameDir(inst.id);
});
// Моды сборки — открывает вкладку «Моды» на весь экран в рамках этой сборки
$("#homeInstMods")?.addEventListener("click", () => {
  const inst = window.__activeInstForMenu;
  if (inst) openInstanceMods(inst);
});
$("#homeInstDel")?.addEventListener("click", async () => {
  const inst = window.__activeInstForMenu;
  if (!inst || !window.launcher) return;
  if (!confirm(`Удалить сборку «${inst.name}»? Миры и моды будут удалены.`)) return;
  clickSound(500);
  const res = await launcher.instanceDelete(inst.id);
  if (res.ok) {
    toast("🗑 Сборка удалена");
    if (selectedInstance === inst.id) selectedInstance = null;
    window.__activeInstForMenu = null;
    refreshInstances();
  } else {
    toast("✖ " + (res.error || "Ошибка удаления"));
  }
});

/* ---------- Меню сборки (настройки) ---------- */
let menuInstance = null;

function openInstanceMenu(inst) {
  const menu = $("#instanceMenu");
  if (!menu) return;
  menuInstance = inst;
  menu.classList.remove("is-hidden");
  refreshInstanceMenu();
  switchInstMenuTab("settings");
}
function closeInstanceMenu() {
  $("#instanceMenu").classList.add("is-hidden");
  menuInstance = null;
}
function switchInstMenuTab(tab) {
  $$(".inst-menu-tab").forEach(t => t.classList.toggle("is-active", t.dataset.itab === tab));
  $$(".inst-tab").forEach(t => t.classList.toggle("is-active", t.id === ("instTab" + (tab[0].toUpperCase() + tab.slice(1)))));
}

async function refreshInstanceMenu() {
  if (!menuInstance) return;
  let inst = menuInstance;
  try {
    const list = await launcher.instancesList();
    inst = list.find(x => x.id === menuInstance.id) || menuInstance;
    menuInstance = inst;
  } catch {}
  $("#instMenuIcon").textContent = inst.icon || "⛏";
  $("#instMenuName").textContent = inst.name;
  $("#instMenuVer").textContent = inst.versionId || inst.mcVersion || "—";
  $("#instMenuMcVersion").textContent = inst.mcVersion || "—";
  $("#instMenuLoader").textContent = loaderName(inst.loader);
  $("#instMenuRam").value = inst.ramGB || 4;
  updateInstMenuRam();
  $("#instMenuJvm").value = inst.extraJvm || "";
  fillInstMenuJava(inst);
  $("#instMenuServer").value = inst.serverIp || "";
  $("#instMenuFullscreen").checked = !!inst.fullscreen;
}

/* Селект «Java для этой сборки»: авто + установленные рантаймы/системные */
function fillInstMenuJava(inst) {
  const sel = $("#instMenuJava");
  if (!sel) return;
  const cur = inst?.javaPath || "auto";
  const opts = ['<option value="auto">🪄 Автоматически</option>'];
  for (const j of JAVA_LIST) {
    const label = `Java ${j.major}${j.vendor ? " • " + j.vendor : ""}`;
    opts.push(`<option value="${esc(j.path)}">${esc(label)}</option>`);
  }
  if (cur !== "auto" && !JAVA_LIST.some(j => j.path === cur)) {
    opts.push(`<option value="${esc(cur)}">${esc(cur)}</option>`);
  }
  sel.innerHTML = opts.join("");
  sel.value = cur;
}

function updateInstMenuRam() {
  const val = +$("#instMenuRam").value;
  $("#instMenuRamLabel").textContent = val + " ГБ";
  $("#instMenuRam").style.setProperty("--fill", ((val - 1) / 15 * 100) + "%");
}

/* --- привязка меню --- */
$("#instMenuClose")?.addEventListener("click", closeInstanceMenu);
$("#instanceMenu")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeInstanceMenu(); });
$$(".inst-menu-tab").forEach(t => t.addEventListener("click", () => { clickSound(520); switchInstMenuTab(t.dataset.itab); }));
$("#instMenuRam")?.addEventListener("input", updateInstMenuRam);
$("#instMenuSaveSettings")?.addEventListener("click", async () => {
  if (!menuInstance || !window.launcher) return;
  const res = await launcher.instanceUpdate({
    id: menuInstance.id,
    ramGB: +$("#instMenuRam").value,
    extraJvm: $("#instMenuJvm").value,
    javaPath: $("#instMenuJava")?.value && $("#instMenuJava").value !== "auto" ? $("#instMenuJava").value : null,
    serverIp: $("#instMenuServer").value.trim(),
    fullscreen: $("#instMenuFullscreen").checked,
  });
  const st = $("#instMenuStatus");
  if (res.ok) { st.textContent = "✔ Настройки сохранены"; toast("✔ Настройки сборки сохранены"); refreshInstances(); }
  else { st.textContent = "✖ " + (res.error || "Ошибка"); }
});
$("#instMenuPlay")?.addEventListener("click", () => { const inst = menuInstance; closeInstanceMenu(); if (inst) launchInstance(inst); });
$("#instMenuOpenDir")?.addEventListener("click", () => { if (window.launcher) launcher.openGameDir(menuInstance.id); });

async function refreshInstances() {
  if (!window.launcher) return;
  let instances = [];
  try { instances = await launcher.instancesList(); } catch { return; }
  INSTANCES = instances;
  const list = $("#homeInstList");
  if (!list) return;
  list.innerHTML = "";
  $("#homeInstCount").textContent = String(instances.length);
  if (!instances.length) {
    list.innerHTML = '<div class="instances-empty"><b>Нет сборок</b>Создайте первую — выберите версию и загрузчик.</div>';
    showInstDetail(null);
    return;
  }
  const active = selectedInstance && instances.some(x => x.id === selectedInstance)
    ? selectedInstance : instances[0].id;
  selectedInstance = active;
  for (const inst of instances) {
    const row = document.createElement("button");
    row.className = "inst-row" + (inst.id === active ? " is-active" : "");
    row.setAttribute("data-instance", inst.id);
    row.innerHTML = `
      <div class="inst-row__icon">${esc(inst.icon || "⛏")}</div>
      <div class="inst-row__info">
        <div class="inst-row__name">${esc(inst.name)}</div>
        <div class="inst-row__ver"><b>${esc(inst.versionId || inst.mcVersion || "")}</b> • ${esc(loaderName(inst.loader))}</div>
      </div>`;
    row.addEventListener("click", () => {
      clickSound(560);
      selectedInstance = inst.id;
      renderInstRows();
      showInstDetail(inst);
    });
    list.appendChild(row);
  }
  showInstDetail(instances.find(x => x.id === active));
}

function renderInstRows() {
  $$("#homeInstList .inst-row").forEach(r =>
    r.classList.toggle("is-active", r.getAttribute("data-instance") === selectedInstance));
}

function showInstDetail(inst) {
  const body = $("#homeInstDetailBody");
  const empty = $("#homeInstEmpty");
  if (!body || !empty) return;
  if (!inst) {
    body.classList.add("is-hidden");
    empty.classList.remove("is-hidden");
    return;
  }
  empty.classList.add("is-hidden");
  body.classList.remove("is-hidden");
  $("#homeInstIcon").textContent = inst.icon || "⛏";
  $("#homeInstName").textContent = inst.name;
  $("#homeInstSub").textContent = `Сборка ${inst.id}`;
  $("#homeInstVer").textContent = inst.versionId || inst.mcVersion || "—";
  $("#homeInstLoader").textContent = loaderName(inst.loader);
  $("#homeInstRam").textContent = (inst.ramGB || 4) + " ГБ";
  $("#homeInstModsCount").textContent = "—";
  const badges = $("#homeInstBadges");
  badges.innerHTML = "";
  const add = (txt, cls) => {
    const s = document.createElement("span");
    s.className = "instance-badge instance-badge--" + cls;
    s.textContent = txt;
    badges.appendChild(s);
  };
  add(loaderName(inst.loader), inst.loader === "vanilla" ? "vanilla" : inst.loader);
  add("MC " + (inst.mcVersion || inst.versionId || "—"), inst.loader === "vanilla" ? "vanilla" : "loader");
  if (inst.fullscreen) add("🖥 Полный экран", "loader");
  updatePlayButtons();
  $("#homeInstStatus").textContent = "—";
  // кол-во модов в сборке
  if (window.launcher) {
    launcher.modsInstalled(inst.id).then(r => {
      $("#homeInstModsCount").textContent = String((r.files || r).length);
    }).catch(() => {});
  }
  window.__activeInstForMenu = inst;
}

function esc(s) { return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function fillInstVersionSelect(preselect) {
  const sel = $("#instVersionSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const releases = allVersionItems().filter(v => v.type === "release" && !v.loader);
  for (const v of releases) {
    const o = document.createElement("option");
    o.value = v.id; o.textContent = v.id;
    sel.appendChild(o);
  }
  const want = preselect || $("#versionSelect").value || "1.21.4";
  if ([...sel.options].some(o => o.value === want)) sel.value = want;
}

function updateInstRam() {
  const val = +$("#instRamSlider").value;
  $("#instRamLabel").textContent = val + " ГБ";
  $("#instRamSlider").style.setProperty("--fill", ((val - 1) / 15 * 100) + "%");
}

function openInstanceDialog(inst) {
  const dlg = $("#instanceDialog");
  if (!dlg) return;
  dlg.classList.remove("is-hidden");
  dlg.dataset.editId = inst ? inst.id : "";
  $("#instanceDlgTitle").textContent = inst ? "Настройки сборки" : "Новая сборка";
  $("#instanceDlgSave").textContent = inst ? "Сохранить" : "Создать сборку";
  $("#instName").value = inst ? inst.name : "";
  $("#instRamSlider").value = inst ? (inst.ramGB || 4) : 4;
  updateInstRam();
  dlgIcon = inst ? (inst.icon || "⛏") : "⛏";
  dlgLoader = inst ? (inst.loader || "vanilla") : "vanilla";
  $$(".inst-icon").forEach(i => i.classList.toggle("is-active", i.dataset.icon === dlgIcon));
  $$(".inst-loader").forEach(l => l.classList.toggle("is-active", l.dataset.loader === dlgLoader));
  fillInstVersionSelect(inst ? inst.mcVersion : null);
  $("#instanceDlgStatus").textContent = "";
}

function closeInstanceDialog() { $("#instanceDialog").classList.add("is-hidden"); }

/* ---------- Каталог сборок (Modrinth / FTB / импорт .mrpack) ---------- */
let packSource = "modrinth";
let packResults = [];
let packInstalling = false;

function syncPackTabs() {
  $$("#catalogDialog .catalog-tabs .mods-tab").forEach(t =>
    t.classList.toggle("is-active", t.dataset.source === packSource));
}

function openCatalog() {
  const dlg = $("#catalogDialog");
  if (!dlg) return;
  dlg.classList.remove("is-hidden");
  $("#catalogGrid").innerHTML = "";
  $("#catalogStatus").textContent = "—";
  $("#catalogBar").style.width = "0%";
  syncPackTabs();
  if (packSource === "modrinth") loadPopularPacks();
  else { $("#catalogHint").textContent = "Введите название сборки FTB (минимум 4 символа) и нажмите «Искать»."; }
}

function closeCatalog() { $("#catalogDialog").classList.add("is-hidden"); }

$("#homeCatalogBtn")?.addEventListener("click", () => { clickSound(640); openCatalog(); });
$("#catalogClose")?.addEventListener("click", () => { clickSound(500); closeCatalog(); });
$("#catalogDialog")?.addEventListener("click", e => { if (e.target === e.currentTarget && !packInstalling) closeCatalog(); });
$$("#catalogDialog .catalog-tabs .mods-tab").forEach(t => t.addEventListener("click", () => {
  packSource = t.dataset.source;
  clickSound(560);
  syncPackTabs();
  packResults = [];
  buildPackCards();
  if (packSource === "modrinth") loadPopularPacks();
  else {
    $("#catalogHint").textContent = "Введите название сборки FTB (минимум 4 символа) и нажмите «Искать».";
    $("#catalogStatus").textContent = "—";
  }
}));

async function loadPopularPacks() {
  if (!window.launcher) return;
  const hint = $("#catalogHint");
  if (hint) hint.textContent = "Загружаем популярные сборки Modrinth…";
  try {
    const res = await launcher.modpacksSearch({ source: "modrinth", query: "", gameVersion: "" });
    if (res.ok) {
      packResults = res.packs;
      buildPackCards();
      if (hint) hint.textContent = "Популярные сборки Modrinth — нажмите «Установить».";
    } else if (hint) hint.textContent = "✖ " + (res.error || "Ошибка");
  } catch {}
}

async function doPackSearch() {
  if (!window.launcher) return toast("⚠ Каталог доступен в десктопной версии");
  const q = ($("#catalogSearchInput")?.value || "").trim();
  if (packSource === "ftb" && q.length < 4) {
    return toast("Для FTB нужно минимум 4 символа");
  }
  if (packSource === "modrinth" && !q) return loadPopularPacks();
  clickSound(600);
  const hint = $("#catalogHint");
  if (hint) hint.textContent = "Ищем сборки…";
  const res = await launcher.modpacksSearch({ source: packSource, query: q, gameVersion: "" });
  if (res.ok) {
    packResults = res.packs;
    buildPackCards();
    if (hint) hint.textContent = packResults.length ? `Найдено сборок: ${packResults.length}` : "Ничего не найдено";
  } else {
    if (hint) hint.textContent = "✖ " + (res.error || "Ошибка поиска");
    toast("✖ " + (res.error || "Ошибка поиска"), 4200);
  }
}

$("#catalogSearchBtn")?.addEventListener("click", doPackSearch);
$("#catalogSearchInput")?.addEventListener("keydown", e => { if (e.key === "Enter") doPackSearch(); });
// Автопоиск с задержкой — только для Modrinth: FTB-поиск требует запроса к API
// на каждую сборку списка, спамить на каждый символ нельзя.
let packSearchTimer = null;
$("#catalogSearchInput")?.addEventListener("input", () => {
  clearTimeout(packSearchTimer);
  if (packSource !== "modrinth") return;
  packSearchTimer = setTimeout(doPackSearch, 500);
});

function buildPackCards() {
  const grid = $("#catalogGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!packResults.length) {
    grid.innerHTML = packSource === "ftb"
      ? '<div class="ver-empty">Введите название сборки FTB и нажмите «Искать».</div>'
      : '<div class="ver-empty">Ничего не найдено. Попробуйте другой запрос.</div>';
    return;
  }
  for (const p of packResults) {
    const card = document.createElement("div");
    card.className = "mod-card pack-card";
    const dl = p.downloads ? `${formatDownloads(p.downloads)} скачиваний` : "";
    const mc = (p.mcVersions || []).slice(-3).join(", ");
    const loaderTags = (p.loaders || []).length
      ? '<div class="mod-card__loaders">' + p.loaders.map(l => `<span class="mod-loader-tag">${esc(String(l).toUpperCase())}</span>`).join("") + "</div>" : "";
    const icon = p.iconUrl
      ? `<img class="mod-card__icon mod-card__icon--img" src="${esc(p.iconUrl)}" alt="" draggable="false" loading="lazy"/>`
      : '<div class="mod-card__icon">📦</div>';
    card.innerHTML = `
      ${icon}
      <div class="mod-card__name">${esc(p.title || p.id)}</div>
      <div class="mod-card__desc">${esc((p.description || "").slice(0, 110))}${loaderTags}</div>
      <div class="mod-card__foot">
        <span class="mod-card__dl">${esc(dl)}${mc ? " • MC " + esc(mc) : ""}</span>
        <button class="mod-toggle" data-install>⬇ Установить</button>
      </div>`;
    card.querySelector("[data-install]").addEventListener("click", e => installPackCard(e.currentTarget, p));
    grid.appendChild(card);
  }
}

async function installPackCard(btn, p) {
  if (!window.launcher || packInstalling) return;
  packInstalling = true;
  btn.disabled = true;
  btn.textContent = "⏳ Установка…";
  clickSound(700);
  const st = $("#catalogStatus"), bar = $("#catalogBar");
  if (st) st.textContent = "Подготовка…";
  if (bar) bar.style.width = "0%";
  try {
    const res = await launcher.modpacksInstall({ source: p.source, id: p.id, name: p.title });
    if (res.ok) {
      btn.textContent = "✔ Установлена";
      if (st) st.textContent = `Сборка «${res.instance.name}» установлена — можно играть`;
      if (bar) bar.style.width = "100%";
      toast(`✔ Сборка «${res.instance.name}» установлена`);
      selectedInstance = res.instance.id;
      closeCatalog();
      setMode("advanced");
      await refreshInstances();
    } else {
      btn.textContent = "⬇ Установить";
      if (st) st.textContent = "✖ " + (res.error || "Ошибка установки");
      toast("✖ " + (res.error || "Ошибка установки"), 5000);
    }
  } catch (e) {
    btn.textContent = "⬇ Установить";
    if (st) st.textContent = "✖ " + (e.message || "Ошибка");
  }
  packInstalling = false;
  btn.disabled = false;
}

$("#catalogImportBtn")?.addEventListener("click", async () => {
  if (!window.launcher || packInstalling) return;
  packInstalling = true;
  clickSound(700);
  const st = $("#catalogStatus"), bar = $("#catalogBar");
  if (st) st.textContent = "Выберите файл .mrpack…";
  try {
    const res = await launcher.modpacksImport();
    if (res.canceled) { if (st) st.textContent = "—"; }
    else if (res.ok) {
      if (st) st.textContent = `Сборка «${res.instance.name}» установлена — можно играть`;
      if (bar) bar.style.width = "100%";
      toast(`✔ Сборка «${res.instance.name}» импортирована`);
      selectedInstance = res.instance.id;
      closeCatalog();
      setMode("advanced");
      await refreshInstances();
    } else {
      if (st) st.textContent = "✖ " + (res.error || "Ошибка импорта");
      toast("✖ " + (res.error || "Ошибка импорта"), 5000);
    }
  } catch (e) {
    if (st) st.textContent = "✖ " + (e.message || "Ошибка");
  }
  packInstalling = false;
});

// Прогресс установки сборки (статус + тонкая полоса в диалоге каталога)
if (window.launcher) {
  launcher.onPackProgress(p => {
    const st = $("#catalogStatus");
    if (st && p.stage) st.textContent = p.stage;
    const bar = $("#catalogBar");
    if (bar && typeof p.pct === "number") bar.style.width = p.pct + "%";
  });
}

/* ---------- Обновления (GitHub Releases) ---------- */
let lastUpdate = null;

function setUpdateStatus(text, warn) {
  const st = $("#updateStatus");
  if (st) { st.textContent = text; st.classList.toggle("is-warn", !!warn); }
}

// Автопроверка при старте: если включён тумблер «Обновлять ядро автоматически»
// и найден новый релиз — уведомляем (баннер на странице «Настройки»).
(async () => {
  const auto = $("#setAutoUpdate");
  if (auto) auto.checked = localStorage.getItem("epic-autoupdate") !== "off";
  if (auto) auto.addEventListener("change", () =>
    localStorage.setItem("epic-autoupdate", auto.checked ? "on" : "off"));
  if (!window.launcher) return;
  try {
    const v = await launcher.appVersion();
    $("#updateCurrent").textContent = "v" + v;
  } catch {}
  if (!auto || !auto.checked) return;
  try {
    const r = await launcher.updateCheck();
    if (r.ok && r.update) {
      lastUpdate = r;
      $("#updateVersionLabel").textContent = r.latest;
      $("#updateInstallBtn").classList.remove("is-hidden");
      setUpdateStatus(`Доступна новая версия: ${r.latest} (у вас ${r.current})`);
      toast(`⬆ Доступна новая версия лаунчера: ${r.latest} — обновить в «Настройках»`, 6000);
    }
  } catch {}
})();

$("#updateCheckBtn")?.addEventListener("click", async () => {
  if (!window.launcher) return toast("⚠ Доступно в десктопной версии");
  clickSound(600);
  setUpdateStatus("Проверяем обновления…");
  const r = await launcher.updateCheck();
  if (!r.ok) return setUpdateStatus("✖ Не удалось проверить: " + (r.error || "нет ответа"), true);
  lastUpdate = r;
  if (!r.update) {
    $("#updateInstallBtn").classList.add("is-hidden");
    return setUpdateStatus(`✔ У вас последняя версия (${r.current})${r.latest ? ` • на GitHub: ${r.latest}` : ""}`);
  }
  $("#updateVersionLabel").textContent = r.latest;
  $("#updateInstallBtn").classList.remove("is-hidden");
  setUpdateStatus(`⬆ Доступно обновление: ${r.latest} (у вас ${r.current})`);
});

$("#updateInstallBtn")?.addEventListener("click", async () => {
  if (!window.launcher || !lastUpdate?.asset) return toast("⚠ Нет доступного файла обновления");
  clickSound(700);
  const btn = $("#updateInstallBtn");
  btn.disabled = true;
  setUpdateStatus(`Скачиваем ${lastUpdate.asset.name}…`);
  const prog = $("#updateProgress");
  if (prog) prog.classList.add("is-on");
  launcher.onUpdateProgress(({ percent, done, total }) => {
    $("#updateBar").style.width = (percent < 0 ? 0 : percent) + "%";
    const mb = (b) => (b / 1048576).toFixed(1) + " МБ";
    $("#updateText").textContent = total ? `${mb(done)} / ${mb(total)} • ${percent}%` : `${mb(done)}`;
  });
  const res = await launcher.updateInstall({ assetUrl: lastUpdate.asset.url, version: lastUpdate.latest });
  btn.disabled = false;
  if (res.ok) {
    setUpdateStatus("✔ Установщик запущен — лаунчер закроется, завершите установку и запустите игру заново");
    toast("⬆ Установщик обновления запущен");
  } else {
    setUpdateStatus("✖ " + (res.error || "Ошибка установки"), true);
    toast("✖ " + (res.error || "Ошибка установки"), 5000);
  }
});

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

/* ---------- Аккаунт: EPIC account (БД) / оффлайн ---------- */
let account = null; // {type,nick,uuid,...}

function renderAccount() {
  const typeEl = $("#accountType");
  const logout = $("#logoutBtn");
  if (account) {
    typeEl.textContent = account.type === "epic"
      ? `▍EPIC account • ${account.nick}` : `▍Оффлайн • ${account.nick}`;
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
  // Ссылка на чип в топбаре
  refreshIdentity();
}

// ---- Модалка EPIC account ----
function openEpicAuthDialog() {
  $("#epicAuthDialog").classList.remove("is-hidden");
  $("#epicAuthNick").focus();
}
function closeEpicAuthDialog() {
  $("#epicAuthDialog").classList.add("is-hidden");
}
function setEpicStatus(msg, warn) {
  const st = $("#epicAuthStatus");
  if (!st) return;
  st.textContent = msg;
  st.classList.toggle("is-warn", !!warn);
}

$("#msLoginBtn")?.addEventListener("click", () => { clickSound(700); openEpicAuthDialog(); });
$("#epicAuthClose")?.addEventListener("click", closeEpicAuthDialog);
$("#epicAuthDialog")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeEpicAuthDialog(); });

async function epicSubmit(mode) {
  if (!window.launcher) return toast("⚠ EPIC account доступен в десктопной версии");
  const nick = $("#epicAuthNick").value.trim();
  const pass = $("#epicAuthPass").value;
  if (!nick || !pass) return setEpicStatus("Введите ник и пароль", true);
  setEpicStatus(mode === "register" ? "Создаём аккаунт…" : "Входим…");
  const res = mode === "register"
    ? await launcher.epicRegister({ username: nick, password: pass })
    : await launcher.epicLogin({ username: nick, password: pass });
  if (res.ok) {
    account = res.account;
    closeEpicAuthDialog();
    $("#epicAuthPass").value = "";
    renderAccount();
    toast(`🔥 EPIC account: вошли как ${account.nick}`);
  } else {
    setEpicStatus(res.error || "Ошибка", true);
  }
}

$("#epicAuthLoginBtn")?.addEventListener("click", () => epicSubmit("login"));
$("#epicAuthRegisterBtn")?.addEventListener("click", () => epicSubmit("register"));
$("#epicAuthPass")?.addEventListener("keydown", e => { if (e.key === "Enter") epicSubmit("login"); });
$("#epicAuthNick")?.addEventListener("keydown", e => { if (e.key === "Enter") $("#epicAuthPass").focus(); });

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

// Проверка связи с сервером EPIC account (страница «Аккаунты»)
$("#epicTestBtn")?.addEventListener("click", async () => {
  const st = $("#epicTestStatus");
  clickSound(600);
  if (st) st.textContent = "Проверяем…";
  if (!window.launcher) { if (st) st.textContent = "⚠ Доступно в десктопной версии"; return; }
  const res = await launcher.epicTest();
  if (st) st.textContent = res.ok ? "▍Сервер в сети — вход и регистрация доступны" : "▍Сервер недоступен: " + (res.error || "нет ответа");
});

async function restoreAccount() {
  if (!window.launcher) return;
  try {
    account = await launcher.getAccount();
    // Microsoft-аккаунт больше не используется — переводим в оффлайн-вид.
    // EPIC account (из БД) остаётся как есть.
    if (account && account.type === "microsoft") account = { type: "offline", nick: account.nick };
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

/* ---------- Моды (Modrinth) ---------- */
let modSource = "modrinth";        // modrinth | curseforge | installed
let modResults = [];               // найденные моды
let installedMods = [];            // скачанные .jar в папке mods
let installedMeta = [];            // манифест: {source, modId, slug, title, filename}
let activeModsInstance = null;     // сборка, чьи моды сейчас просматриваем (null = простой режим)

function modsCurrentVersion() {
  if (activeModsInstance && activeModsInstance.mcVersion) return activeModsInstance.mcVersion;
  return $("#modsVersionSelect")?.value || $("#versionSelect").value || "1.21.4";
}

// Открыть вкладку «Моды» на весь экран в рамках выбранной сборки (продвинутый режим).
async function openInstanceMods(inst) {
  if (!window.launcher) return toast("⚠ Доступно в десктопной версии");
  clickSound(560);
  activeModsInstance = inst;
  modSource = "modrinth";
  // Включаем страницу «Моды» как активную (nav скрыта, но страницу показываем)
  $$(".nav__item").forEach(b => b.classList.toggle("is-active", false));
  $$(".page").forEach(p => p.classList.toggle("is-active", p.id === "page-mods"));
  const ctx = $("#modsContext");
  if (ctx) ctx.classList.remove("is-hidden");
  const lbl = $("#modsContextLabel");
  if (lbl) lbl.textContent = `Сборка «${inst.name}» — моды скачиваются в её папку`;
  const t = $("#modsPageTitle");
  if (t) t.textContent = `Моды — ${inst.name}`;
  const hint = $("#modsSearchHint");
  if (hint) hint.textContent = `Моды сборки «${inst.name}» — скачиваются в папку mods этой сборки.`;
  $("#modsSearchInput").value = "";
  $("#modsSearchInput").placeholder = "Поиск модов для «" + inst.name + "»…";
  syncModTabs();
  try { ({ files: installedMods, manifest: installedMeta } = await launcher.modsInstalled(inst.id)); } catch {}
  await loadPopularMods();
}

function closeInstanceMods() {
  activeModsInstance = null;
  const ctx = $("#modsContext");
  if (ctx) ctx.classList.add("is-hidden");
  const t = $("#modsPageTitle");
  if (t) t.textContent = "Моды";
  $("#modsSearchInput").placeholder = "Поиск модов…";
  const hint = $("#modsSearchHint");
  if (hint) hint.textContent = "Нажмите «Искать» или выберите из популярных ниже — мод скачается в папку mods.";
  // возвращаемся к сборкам
  $$(".nav__item").forEach(b => b.classList.toggle("is-active", b.dataset.page === "home"));
  $$(".page").forEach(p => p.classList.toggle("is-active", p.id === "page-home"));
}
$("#modsBackBtn")?.addEventListener("click", () => { clickSound(520); closeInstanceMods(); });

function formatDownloads(n) {
  if (!n) return "";
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : (n / 1e3).toFixed(0) + "K";
}

function buildMods(filter = "") {
  const grid = $("#modsGrid");
  grid.innerHTML = "";

  if (modSource === "installed") {
    const list = installedMods.filter(f => !filter || f.toLowerCase().includes(filter.toLowerCase()));
    if (!list.length) { grid.innerHTML = '<div class="ver-empty">Моды ещё не скачаны. Перейдите на вкладку «Популярные» и установите мод.</div>'; return; }
    list.forEach(f => {
      const card = document.createElement("div");
      card.className = "mod-card";
      card.innerHTML = `
        <div class="mod-card__icon">📦</div>
        <div class="mod-card__name">${esc(f.replace(/\.jar$/i, ""))}</div>
        <div class="mod-card__desc">Установленный мод в папке mods.</div>
        <div class="mod-card__foot"><span class="mod-card__dl">✔ Установлен</span><button class="mod-toggle is-on" data-del>🗑 Удалить</button></div>`;
      const del = card.querySelector("[data-del]");
      del.addEventListener("click", async () => {
        clickSound(500);
        if (!window.launcher) return toast("⚠ Доступно в десктопной версии");
        const res = await launcher.modsDelete(f, activeModsInstance?.id);
        if (res.ok) {
          toast(`🗑 Мод «${f.replace(/\.jar$/i, "")}» удалён`);
          ({ files: installedMods, manifest: installedMeta } = await launcher.modsInstalled(activeModsInstance?.id));
          buildMods(filter);
        } else {
          toast("✖ " + (res.error || "Не удалось удалить"));
        }
      });
      grid.appendChild(card);
    });
    return;
  }

  if (!modResults.length) {
    grid.innerHTML = '<div class="ver-empty">Введите название мода и нажмите «Искать».</div>';
    return;
  }
  modResults
    .filter(m => !filter || (m.title || "").toLowerCase().includes(filter.toLowerCase()))
    .forEach(m => {
      const card = document.createElement("div");
      card.className = "mod-card";
      const dl = m.downloads ? `${formatDownloads(m.downloads)} скачиваний` : "";
      const loaderTags = (m.loaders || []).length
        ? '<div class="mod-card__loaders">' + m.loaders.map(l => `<span class="mod-loader-tag">${l.toUpperCase()}</span>`).join("") + "</div>" : "";
      const icon = m.iconUrl
        ? `<img class="mod-card__icon mod-card__icon--img" src="${esc(m.iconUrl)}" alt="" draggable="false" loading="lazy"/>`
        : '<div class="mod-card__icon">🧩</div>';
      const isInst = modIsInstalled(m);
      card.innerHTML = `
        ${icon}
        <div class="mod-card__name">${esc(m.title || m.slug)}</div>
        <div class="mod-card__desc">${esc((m.description || "").slice(0, 120))}${loaderTags}</div>
        <div class="mod-card__foot">
          <span class="mod-card__dl">${dl}</span>
          <button class="mod-toggle${isInst ? " is-on" : ""}" data-dl${isInst ? " disabled" : ""}>${isInst ? "✔ Установлен" : "⬇ Скачать"}</button>
        </div>`;
      card.querySelector("[data-dl]").addEventListener("click", async e => {
        const btn = e.currentTarget;
        btn.textContent = "⏳ …";
        btn.disabled = true;
        clickSound(700);
        const loader = $("#modsLoaderSelect")?.value || "any";
        // ВАЖНО: await должен покрывать весь тернарник — иначе res = Promise
        // («{}»), скачивание проходит, но карточка показывает «✖ Не удалось скачать».
        const res = await (window.launcher
          ? launcher.modsDownload({ source: m.source, modId: m.id, gameVersion: modsCurrentVersion(), loader, title: m.title || "", slug: m.slug || "", instanceId: activeModsInstance?.id })
          : Promise.resolve({ ok: false, error: "Доступно в десктопной версии" }));
        if (res.ok) {
          toast(`✔ Мод «${m.title}» скачан в mods/`);
          try { ({ files: installedMods, manifest: installedMeta } = await launcher.modsInstalled(activeModsInstance?.id)); } catch {}
          buildMods($("#modsSearchInput")?.value || "");
        } else {
          btn.textContent = "⬇ Скачать";
          btn.disabled = false;
          toast("✖ " + (res.error || "Не удалось скачать"), 4200);
        }
      });
      grid.appendChild(card);
    });
}

/* Мод уже скачан? — сначала точное совпадение по манифесту (modId/slug), затем эвристика по файлам */
function modIsInstalled(m) {
  if (installedMeta.some(x =>
    (m.id && x.modId && String(x.modId) === String(m.id)) ||
    (m.slug && x.slug && x.slug.toLowerCase() === m.slug.toLowerCase()))) return true;
  const keys = [];
  for (const s of [m.slug, m.title]) {
    if (!s) continue;
    const low = s.toLowerCase();
    keys.push(low.replace(/\s+/g, "-"), low.replace(/\s+/g, ""));
  }
  return installedMods.some(f => {
    const n = f.toLowerCase();
    return keys.some(k => k.length > 2 && n.includes(k));
  });
}

async function loadPopularMods() {
  if (!window.launcher) return;
  const hint = $("#modsSearchHint");
  if (hint) hint.textContent = "Загружаем популярные моды…";
  try {
    const res = await launcher.modsSearch({ source: "modrinth", query: "", gameVersion: modsCurrentVersion() });
    if (res.ok) {
      modResults = res.mods;
      buildMods();
      if (hint) hint.textContent = `Популярные моды для версии ${modsCurrentVersion()} — нажмите «Скачать».`;
    }
  } catch {}
}

function fillModsVersionSelect() {
  const sel = $("#modsVersionSelect");
  if (!sel) return;
  const items = allVersionItems().filter(v => v.type === "release" && !v.loader);
  sel.innerHTML = '<option value="">Любая версия</option>';
  for (const v of items.slice(0, 30)) {
    const o = document.createElement("option");
    o.value = v.id; o.textContent = v.id;
    sel.appendChild(o);
  }
  const cur = $("#versionSelect").value;
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

async function refreshInstalledMods() {
  if (!window.launcher) return;
  try { ({ files: installedMods, manifest: installedMeta } = await launcher.modsInstalled(activeModsInstance?.id)); } catch {}
  if (modSource === "installed") buildMods();
  else if (modResults.length) buildMods($("#modsSearchInput")?.value || "");
}

async function doModSearch() {
  if (!window.launcher) return toast("⚠ Поиск модов доступен в десктопной версии");
  const q = ($("#modsSearchInput")?.value || "").trim();
  if (!q) return loadPopularMods();
  clickSound(600);
  if (modSource === "installed") { modSource = "modrinth"; syncModTabs(); }
  const hint = $("#modsSearchHint");
  if (hint) hint.textContent = "Ищем…";
  const res = await launcher.modsSearch({ source: modSource, query: q, gameVersion: modsCurrentVersion() });
  if (res.ok) { modResults = res.mods; buildMods(); if (hint) hint.textContent = `Найдено: ${res.mods.length} модов`; }
  else { toast("✖ " + (res.error || "Ошибка поиска")); if (hint) hint.textContent = "Ошибка поиска"; }
}

$("#modsSearchBtn")?.addEventListener("click", doModSearch);
$("#modsSearchInput")?.addEventListener("keydown", e => { if (e.key === "Enter") doModSearch(); });
// Автопоиск с задержкой при вводе — не нужно жать кнопку.
let modSearchTimer = null;
$("#modsSearchInput")?.addEventListener("input", () => {
  clearTimeout(modSearchTimer);
  modSearchTimer = setTimeout(doModSearch, 400);
});
$("#modsLoaderSelect")?.addEventListener("change", () => { if (modSource === "modrinth" && modResults.length) doModSearch(); });
$("#modsVersionSelect")?.addEventListener("change", () => { if (modSource === "modrinth") doModSearch(); });

function syncModTabs() {
  $$(".mods-tab").forEach(t => t.classList.toggle("is-active", t.dataset.source === modSource));
}
$$(".mods-tab").forEach(t => t.addEventListener("click", () => {
  modSource = t.dataset.source;
  clickSound(560);
  syncModTabs();
  if (modSource === "installed") { modResults = []; refreshInstalledMods(); }
  else { doModSearch(); }
}));

/* ---------- Поиск: фильтрует и моды, и версии ---------- */
$("#searchInput").addEventListener("input", e => {
  const q = e.target.value;
  versionFilter = q;
  buildMods(q);
  renderVersionPanel();
});

// Из id версии достаём базовую ванильную версию Minecraft (для установки
// загрузчика при запуске). Например: "1.20.1-forge-47.4.28" -> "1.20.1",
// "fabric-loader-0.20.1-1.20.1" -> "1.20.1", "1.21.4" -> "1.21.4".
function baseGameVersion(id) {
  if (!id) return id;
  let m = id.match(/^fabric-loader-[\d.]+-(\d[\w.-]*)$/i);
  if (m) return m[1];
  m = id.match(/^(\d[\w.-]*)-forge-\d[\w.-]*$/i);
  if (m) return m[1];
  return id;
}

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

/**
 * Синхронизирует кнопку запуска в ПРОСТОМ режиме (#playBtn) и кнопку
 * выбранной СБОРКИ (#homeInstPlay): ИГРАТЬ / ЗАПУСК… / ⏹ ОСТАНОВИТЬ.
 * Без этого после запуска сборки кнопка оставалась «ИГРАТЬ».
 */
function updatePlayButtons() {
  const label = launching ? "ЗАПУСК…" : gameRunning ? "⏹ ОСТАНОВИТЬ" : "ИГРАТЬ";
  const pb = $("#playBtn");
  if (pb) {
    pb.classList.toggle("is-loading", launching);
    pb.classList.toggle("is-stop", gameRunning);
    const pl = pb.querySelector(".btn-play__label");
    if (pl) pl.textContent = label;
  }
  const ib = $("#homeInstPlay");
  if (ib) {
    ib.classList.toggle("is-loading", launching);
    ib.classList.toggle("is-stop", gameRunning);
    const il = ib.querySelector(".btn-play__label");
    if (il) il.textContent = label;
  }
  const hint = $("#homeInstPlayHint");
  if (hint) {
    const inst = window.__activeInstForMenu;
    hint.textContent = gameRunning
      ? "Игра запущена — нажмите, чтобы остановить"
      : launching ? "Подготавливаем запуск…"
        : `Запустить ${inst ? (inst.versionId || inst.mcVersion || "") : ""}`.trim();
  }
}

/* ---------- Выбор загрузчика (Ваниль / Fabric / Forge) для запуска ---------- */
let launchLoader = localStorage.getItem("epic-loader") || "vanilla"; // vanilla | fabric | forge | neoforge | quilt
const KNOWN_LOADERS = ["fabric", "forge", "neoforge", "quilt"];
function setLaunchLoader(loader) {
  launchLoader = KNOWN_LOADERS.includes(loader) ? loader : "vanilla";
  localStorage.setItem("epic-loader", launchLoader);
  $$(".loader-option").forEach(b => b.classList.toggle("is-active", b.dataset.loader === launchLoader));
  if (typeof updateVersionInfo === "function") updateVersionInfo();
}
function bindLoaderSelect() {
  $$(".loader-option").forEach(b => b.addEventListener("click", () => { clickSound(540); setLaunchLoader(b.dataset.loader); }));
}

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
  const st = $("#overlayStatus");
  if (st && p.stage) st.textContent = `${p.stage}${speed}${files}`;
});

// Прогресс скачивания Java (диалог «Скачать Java»)
window.launcher?.onJavaProgress?.((p) => {
  const bar = $("#javaBar");
  if (bar) bar.style.width = Math.max(2, p.pct || 0) + "%";
  const line = $("#javaStatusLine");
  if (line) line.textContent = `Скачиваем Java… ${p.pct || 0}%`;
});

window.launcher?.onLog?.((t) => appendLog(t));

window.launcher?.onExit?.(({ code, error }) => {
  gameRunning = false;
  launching = false;
  showOverlay(false);
  setProgress(0, "");
  $("#progress").classList.remove("is-on");
  updatePlayButtons();
  const status = error ? `Ошибка запуска: ${error}` : `Игра закрылась (код выхода: ${code === null ? "остановлена" : code})`;
  $("#setLaunchStatus").textContent = status;
  toast(error ? "✖ " + status : "⏹ Игра остановлена");
});

// ротация советов во время реального запуска
setInterval(() => {
  if (launching) $("#loadingTip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
}, 2500);

async function startLaunch({ instance } = {}) {
  if (gameRunning && window.launcher) {
    await launcher.killGame();
    toast("⏹ Останавливаем игру…");
    gameRunning = false;
    updatePlayButtons();
    return;
  }
  if (launching) return;

  // Продвинутый режим: запускаем активную сборку, а не единую версию
  let cur = null, instanceId = null;
  if (instance) {
    instanceId = instance.id;
    cur = { id: instance.versionId || instance.mcVersion || "1.21.4", url: null, type: "release", releaseTime: "" };
  } else {
    cur = currentVersionObj();
  }
  if (!cur) return toast("Выбери версию игры");

  // Браузерный режим (без Electron) — демо-анимация
  if (!window.launcher) {
    toast("℠ Демо-режим: для реального скачивания запусти desktop-версию (npm start)");
    return demoLaunch(cur.id);
  }

  // Простой режим: если выбран Fabric/Forge — установим загрузчик для этой версии
  // и запустим его, иначе запускаем ванильную версию.
  let simpleLoader = null;
  if (!instanceId && launchLoader !== "vanilla") {
    if (!cur.url) return toast("Выберите ванильную версию для установки загрузчика");
    simpleLoader = launchLoader;
  }

  launching = true;
  clickSound(440, .12, "triangle", .12);
  setTimeout(() => clickSound(660, .12, "triangle", .12), 120);
  setTimeout(() => clickSound(880, .18, "triangle", .12), 240);

  logBuf = "";
  updatePlayButtons();
  setProgress(1, "Готовим запуск…");
  showOverlay(true);
  const st = $("#overlayStatus");
  if (st) st.textContent = "Готовим запуск…";

  // Установка выбранного загрузчика (если нужно) перед запуском.
  // Если загрузчик уже установлен для этой версии — пропускаем (мгновенный запуск).
  if (simpleLoader) {
    const mc = baseGameVersion(cur.id);
    const re = escRe(mc);
    // Уже установленный загрузчик для этой версии — не ставим повторно.
    const patterns = {
      fabric:    new RegExp(`^fabric-loader-[\\d.]+-${re}$`, "i"),
      forge:     new RegExp(`^${re}-forge-[\\w.\\-]+$`, "i"),
      neoforge:  new RegExp(`^${re}-neoforge-[\\w.\\-]+$`, "i"),
      quilt:     new RegExp(`^quilt-loader-[\\w.\\-]+-${re}$`, "i"),
    };
    const existingId = INSTALLED.find(id => patterns[simpleLoader]?.test(id));
    if (existingId) {
      cur = { id: existingId, url: null, type: "release", releaseTime: "" };
    } else {
      setProgress(4, `Устанавливаем ${loaderName(simpleLoader)} для ${mc}…`);
      if (st) st.textContent = `Установка ${loaderName(simpleLoader)} ${mc}…`;
      let lr;
      try {
        lr = await window.launcher.installLoader({ kind: simpleLoader, gameVersion: mc });
      } catch (e) { lr = { ok: false, error: (e && e.message) || String(e) }; }
      if (!lr || !lr.ok) { finishFail((lr && lr.error) || "Ошибка установки загрузчика"); return; }
      await loadInstalledVersions();
      cur = { id: lr.id, url: null, type: "release", releaseTime: "" };
    }
  }

  const opts = {
    versionId: cur.id,
    versionUrl: cur.url || null,
    nick: $("#nickInput").value.trim() || "Steve",
    ramGB: instance ? (instance.ramGB || 4) : +ramSlider.value,
    extraJvm: $("#setJvmArgs")?.value || "",
    fullscreen: $("#setFullscreen")?.checked || false,
    // У сборки свой «Сервер для быстрого входа» (instMenuServer); если он не
    // задан вообще (undefined) — берём глобальный из настроек.
    serverIp: (instance && instance.serverIp != null
      ? String(instance.serverIp)
      : ($("#setServerIp")?.value || "")).trim() || null,
    // Java конкретной сборки (instMenuJava) приоритетнее общей из настроек
    javaPath: (instance && instance.javaPath) || ($("#javaSelect")?.value !== "auto" ? $("#javaSelect").value : null),
    instanceId,
  };
  if (!opts.versionUrl) {
    // локально установленный загрузчик (Fabric/Forge) — его json лежит в versions/
    if (instanceId || simpleLoader) {
      opts.local = true;
    } else if (INSTALLED.includes(opts.versionId) && !allVersionItems().find(v => v.id === opts.versionId && v.url)) {
      opts.local = true;
    } else {
      // fallback-список без url — попросим main найти url
      try {
        const list = await launcher.versionsList();
        REAL_VERSIONS = list;
        const found = list.find(v => v.id === opts.versionId);
        if (!found) { finishFail("Версия не найдена в списке Mojang"); return; }
        opts.versionUrl = found.url;
      } catch (e) { finishFail(e.message); return; }
    }
  }

  const res = await launcher.launch(opts);
  if (!res.ok) { finishFail(res.error); return; }

  gameRunning = true;
  // Игра запущена — убираем оверлей, лаунчером можно пользоваться дальше
  launching = false;
  showOverlay(false);
  setProgress(0, "");
  $("#progress").classList.remove("is-on");
  updatePlayButtons();
  $("#setLaunchStatus").textContent =
    `Java: ${res.java} (${res.source})\nВерсия: ${res.version}\nNatives: ${res.natives}\nСтатус: игра запущена — нажмите «Остановить», чтобы закрыть игру`;
  toast(`⛏ ${opts.nick} запускает Minecraft ${res.version}${instance ? ` (${instance.name})` : ""}!`);
  loadInstalledVersions();

  function finishFail(err) {
    launching = false;
    showOverlay(false);
    updatePlayButtons();
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
  const st = $("#overlayStatus");
  if (st) st.textContent = stages[0];
  const iv = setInterval(() => {
    step++;
    const pct = Math.min(100, step * 100 / stages.length);
    const label = stages[Math.min(step - 1, stages.length - 1)];
    setProgress(pct, `${label} ${Math.round(pct)}%`);
    $("#overlayBar").style.width = pct + "%";
    if (st) st.textContent = label;
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




/* ---------- Инициализация ---------- */
console.time("init-fillVersions"); fillVersions(); console.timeEnd("init-fillVersions");
$("#versionSelect").addEventListener("change", () => { clickSound(500); updateVersionInfo(); localStorage.setItem("epic-version", $("#versionSelect").value); });
updateRam();
console.time("init-buildMods"); buildMods(); console.timeEnd("init-buildMods");
console.time("init-refreshIdentity"); refreshIdentity(); console.timeEnd("init-refreshIdentity");
setMode(appMode, { silent: true });
bindModeSwitches();
bindLoaderSelect();
setLaunchLoader(launchLoader);

// Десктоп: реальные версии + аккаунт + каталог игры
console.time("startup-desktop-init");
if (window.launcher) {
  loadRealVersions();
  loadInstalledVersions();
  restoreAccount();
  // Сначала загружаем список установленных модов, ПОТОМ рисуем популярные —
  // иначе карточки рисовались до готовности манифеста и сбрасывались в «⬇ Скачать».
  refreshInstalledMods().then(() => loadPopularMods());
  refreshJavaList();
  fillModsVersionSelect();
  launcher.gameDir().then(dir => { const el = $("#setGameDir"); if (el) el.value = dir; }).catch(() => {});
  $("#openDirBtn")?.addEventListener("click", () => launcher.openGameDir());
  // выбор сервера из боковой панели -> автозаполняем IP (пусто = одиночная игра)
  $$('input[name="server"]').forEach(r => r.addEventListener("change", () => {
    const ip = $("#setServerIp"); if (ip) ip.value = r.value || "";
  }));

  // ---------- Мои сервера (добавляются пользователем, хранятся в localStorage) ----------
  let USER_SERVERS = [];
  try { USER_SERVERS = JSON.parse(localStorage.getItem("epic-servers") || "[]"); } catch {}
  function saveUserServers() {
    localStorage.setItem("epic-servers", JSON.stringify(USER_SERVERS));
    renderUserServers();
  }
  function renderUserServers() {
    const box = $("#userServers");
    if (!box) return;
    box.innerHTML = "";
    if (!USER_SERVERS.length) {
      box.innerHTML = '<div class="servers__sub">Серверов нет — добавьте свой ниже.</div>';
      return;
    }
    for (const s of USER_SERVERS) {
      const label = document.createElement("label");
      label.className = "server server--row";
      label.dataset.host = s.ip;
      label.innerHTML = `
        <input type="radio" name="server" value="${esc(s.ip)}"/>
        <span class="server__dot"></span>
        <span class="server__name">${esc(s.name || s.ip)}</span>
        <span class="server__ping">…</span>
        <span class="server__del" title="Удалить">🗑</span>`;
      const ip = $("#setServerIp"); if (ip) label.querySelector('input[type="radio"]').addEventListener("change", () => { ip.value = s.ip; });
      label.querySelector(".server__del").addEventListener("click", e => {
        e.preventDefault();
        USER_SERVERS = USER_SERVERS.filter(x => x !== s);
        saveUserServers();
        toast("🗑 Сервер удалён");
      });
      box.appendChild(label);
    }
  }
  $("#userServerAddBtn")?.addEventListener("click", addUserServer);
  $("#userServerIp")?.addEventListener("keydown", e => { if (e.key === "Enter") addUserServer(); });
  function addUserServer() {
    const inp = $("#userServerIp");
    const raw = (inp?.value || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    if (!raw) return toast("Введите IP сервера");
    if (USER_SERVERS.some(s => s.ip === raw)) return toast("Сервер уже добавлен");
    const name = raw.split(".")[0];
    USER_SERVERS.push({ name: name[0].toUpperCase() + name.slice(1), ip: raw });
    inp.value = "";
    saveUserServers();
    toast(`✔ Сервер ${raw} добавлен`);
  }

  // Реальный пинг серверов (Minecraft-протокол) + скрытие недоступных
  function allServerRows() {
    return $$(".server--row[data-host]");
  }
  async function pingAll() {
    const rows = allServerRows();
    let anyOnline = false;
    await Promise.all(rows.map(async (row) => {
      const host = row.dataset.host;
      if (!host) { row.classList.remove("is-offline"); return; }
      const pingEl = row.querySelector(".server__ping");
      try {
        const r = await launcher.serverPing(host);
        if (r.ok) {
          anyOnline = true;
          row.classList.remove("is-offline");
          pingEl.textContent = r.online ? `${r.ms} мс • ${r.online}` : `${r.ms} мс`;
          pingEl.style.color = r.ms < 120 ? "#4ade80" : r.ms < 250 ? "#ffb347" : "#ff7a7a";
        } else {
          row.classList.add("is-offline");
        }
      } catch { row.classList.add("is-offline"); }
    }));
    // если ни один другой сервер не доступен — показываем только EPIC
    const sub = $("#serversSub");
    if (!anyOnline && sub) sub.textContent = "Сервера сейчас недоступны";
    return anyOnline;
  }
  // пинг EPIC (повторяем периодически — сеть может отваливаться временно)
  const EPIC_HOST = "Epic.servmine.top";
  async function pingEpic() {
    const pingEl = $("#epicPing");
    if (!pingEl) return;
    try {
      const r = await launcher.serverPing(EPIC_HOST);
      if (r.ok) {
        pingEl.textContent = r.online ? `${r.ms} мс • ${r.online}` : `${r.ms} мс`;
        pingEl.style.color = r.ms < 120 ? "#4ade80" : r.ms < 250 ? "#ffb347" : "#ff7a7a";
        $("#epicServerBtn").classList.remove("is-offline");
      } else {
        pingEl.textContent = "нет связи";
        pingEl.style.color = "#ff7a7a";
        $("#epicServerBtn").classList.add("is-offline");
      }
    } catch {
      pingEl.textContent = "—";
      $("#epicServerBtn").classList.add("is-offline");
    }
  }
  renderUserServers();
  pingAll();
  pingEpic();
  setInterval(() => { pingAll(); pingEpic(); }, 60_000);

  // кнопка EPIC: сразу запускает на сервере Epic.servmine.top
  $("#epicServerBtn")?.addEventListener("click", () => {
    clickSound(700);
    const ip = $("#setServerIp"); if (ip) ip.value = EPIC_HOST;
    startLaunch();
  });

  // Вписать сервера в servers.dat (меню мультиплеера игры) — только мои сервера
  $("#syncServersBtn")?.addEventListener("click", async () => {
    if (!window.launcher) return toast("⚠ Доступно в десктопной версии");
    clickSound(700);
    const st = $("#serversMpStatus");
    if (st) st.textContent = "Записываем servers.dat…";
    const res = await launcher.serversSync(USER_SERVERS);
    if (res.ok) {
      if (st) st.textContent = `✔ Добавлено серверов: ${res.count}`;
      toast(`✔ Сервера записаны в servers.dat (${res.file})`);
    } else {
      if (st) st.textContent = "✖ " + (res.error || "Ошибка");
      toast("✖ " + (res.error || "Ошибка записи servers.dat"), 5000);
    }
  });
} else {
  $("#chipStatus").textContent = "Браузерный демо-режим";
}
console.timeEnd("startup-desktop-init");

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

console.log("%c⛏ EPIC LAUNCHER готов к приключениям!", "color:#ff7a29;font-size:16px;font-weight:bold");
