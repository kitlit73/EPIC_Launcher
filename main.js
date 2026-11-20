'use strict';
/*
 * EPIC Launcher — Electron main process.
 * Real Minecraft downloading (piston-meta), Mojang Java runtime handling,
 * Microsoft / offline auth and actual game launch.
 */

// Если переменная окружения ELECTRON_RUN_AS_NODE=1 (иногда унаследована из
// терминала/скрипта), Electron запускается как обычный Node.js, и require('electron')
// возвращает undefined -> лаунчер падает при старте. Сбрасываем её до загрузки модулей.
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { getVersionList, buildSpec, buildSpecFromFile, setVersionCacheFile } = require('./src/manifest');
const { Downloader } = require('./src/downloader');
const { resolveJava, listInstalledJava } = require('./src/java');
const { Auth } = require('./src/auth');
const { EpicAuth } = require('./src/epicAuth');
const { checkUpdate, downloadUpdate, runUpdate } = require('./src/updater');
const { buildArgs, launch } = require('./src/launcher');
const { installLoader } = require('./src/loaders');
const instances = require('./src/instances');

let GAME_DIR = '';   // .minecraft root
let RUNTIME_DIR = '';// extracted Mojang JREs
let ACTIVE_INSTANCE = null; // id активной сборки (продвинутый режим)

let win = null;
let currentChild = null;
let msWindow = null;
const auth = { holder: null };
let epicAuth = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 980, minHeight: 640,
    backgroundColor: '#0b1020', autoHideMenuBar: true, icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  const base = app.getPath('userData').replace(/[\\/]epic-launcher$/i, '');
  GAME_DIR = process.env.EPIC_GAME_DIR || path.join(base, 'EpicLauncher', '.minecraft');
  RUNTIME_DIR = path.join(GAME_DIR, 'runtime');
  fs.mkdirSync(GAME_DIR, { recursive: true });
  instances.setInstancesRoot(path.join(path.dirname(GAME_DIR), 'instances'));
  auth.holder = new Auth(GAME_DIR);
  epicAuth = new EpicAuth();
  setVersionCacheFile(path.join(GAME_DIR, 'version-cache.json'));

  // Не чистим кэш HTTP при каждом запуске: это заставляло заново качать
  // манифест версий, список Java, новости и моды, замедляя старт на 3-4с.
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (currentChild) { try { currentChild.kill(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------- IPC ---------------- */

ipcMain.handle('versions:list', async () => {
  const list = await getVersionList();
  return list.map(v => ({ id: v.id, type: v.type, url: v.url, releaseTime: v.releaseTime }));
});

// Version ids already downloaded (folder with <id>.jar exists) or locally
// installed loaders (folder with <id>.json exists, e.g. Fabric/Forge).
ipcMain.handle('versions:installed', async (_e, instanceId) => {
  try {
    const root = instanceId ? instances.instanceGameDir(instanceId) : GAME_DIR;
    const vdir = path.join(root, 'versions');
    if (!fs.existsSync(vdir)) return [];
    return fs.readdirSync(vdir).filter(id => {
      try {
        return fs.existsSync(path.join(vdir, id, `${id}.jar`)) ||
               fs.existsSync(path.join(vdir, id, `${id}.json`));
      } catch { return false; }
    });
  } catch { return []; }
});

ipcMain.handle('account:offline', async (_e, nick) => {
  const a = auth.holder.offline(String(nick || 'Steve').slice(0, 16));
  return publicAccount(a);
});

// EPIC account — регистрация и вход через API-сервер (Render). База (Neon)
// скрыта за сервером; лаунчер никаких SQL/подключений к БД не имеет.
ipcMain.handle('account:epic-register', async (_e, creds) => {
  try {
    await epicAuth.register(creds || {});
    // API выдаёт токен только на логине — сразу авторизуемся теми же кредами,
    // чтобы UI (ожидает { ok, account }) не менялся.
    const a = await epicAuth.login(creds || {});
    auth.holder.save(a);
    return { ok: true, account: publicAccount(a) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('account:epic-login', async (_e, creds) => {
  try {
    const a = await epicAuth.login(creds || {});
    auth.holder.save(a);
    return { ok: true, account: publicAccount(a) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Проверка связи с API (GET /health; для диагностики на странице входа).
ipcMain.handle('account:epic-test', async () => epicAuth.test());

// Версия лаунчера: из package.json (в упакованном приложении он внутри asar).
// app.getVersion() без контекста приложения возвращает версию Electron-рантайма.
function launcherVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || app.getVersion();
  } catch {
    return app.getVersion();
  }
}
ipcMain.handle('app:version', () => launcherVersion());

ipcMain.handle('account:microsoft', async () => {
  return microsoftFlow();
});

// Аккаунт при старте. Для EPIC — сверка с API (me()): uuid мог обновиться
// после миграции паролей, токен — истечь.
ipcMain.handle('account:get', async () => {
  const stored = auth.holder.load();
  if (!stored) return null;

  if (stored.type === 'epic' && stored.token) {
    const me = await epicAuth.me(stored.token);
    if (me.ok && me.user) {
      // Обновляем профиль актуальными с сервера данными.
      const fresh = { ...stored, nick: me.user.username, uuid: me.user.uuid };
      if (fresh.nick !== stored.nick || fresh.uuid !== stored.uuid) {
        auth.holder.save(fresh);
      }
      return publicAccount(fresh);
    }
    if (me.status === 401) {
      // Токен истёк/отозван: стираем токен, профиль остаётся до повторного входа.
      const { token, ...rest } = stored;
      auth.holder.save(rest);
      return publicAccount(rest);
    }
    // Сервер недоступен — работаем на сохранённых данных.
  }
  return publicAccount(stored);
});

ipcMain.handle('account:logout', async () => { auth.holder.clear(); return { ok: true }; });

/* ---------------- Обновления (GitHub Releases) ---------------- */

// Проверка: { ok, update, current, latest, asset? }
ipcMain.handle('update:check', async () => {
  try {
    return await checkUpdate(launcherVersion());
  } catch (e) {
    return { ok: false, error: e.message, current: launcherVersion() };
  }
});

// Установка по кнопке: скачать ассет -> запустить установщик -> закрыть лаунчер.
ipcMain.handle('update:install', async (_e, { assetUrl, version }) => {
  try {
    if (!assetUrl || !/^https:\/\//.test(assetUrl)) throw new Error('Некорректная ссылка на обновление');
    const dest = path.join(app.getPath('temp'), `EpicLauncher-Setup-${version || 'new'}.exe`);
    await downloadUpdate(assetUrl, dest, (percent, done, total) => {
      send('update:progress', { percent, done, total });
    });
    runUpdate(dest);
    // Даём установщику стартовать, затем закрываем лаунчер.
    setTimeout(() => app.quit(), 1200);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// All installed JREs/JDKs (system + launcher-downloaded) for the Java dropdown
ipcMain.handle('java:list', async () => {
  try { return await listInstalledJava(RUNTIME_DIR); } catch (e) { console.error('[java:list]', e); return []; }
});

// Explicitly download the official Mojang runtime for the chosen version
ipcMain.handle('java:download', async (_e, opts) => {
  const { installMojangRuntime, javaMajorVersion } = require('./src/java');
  try {
    let major = null, component = (opts && opts.component) || 'java-runtime-delta';
    // Без явного компонента — подбираем по версии игры (как раньше).
    if (!opts || !opts.component) {
      try {
        const spec = await resolveSpec(opts.versionUrl || null, opts.versionId);
        major = spec.javaMajor; component = spec.javaComponent || component;
      } catch {}
    }
    // Свой канал прогресса: game:status показал бы оверлей запуска игры,
    // который оставался на 15% и не закрывался до конца скачивания.
    send('java:progress', { pct: 0, component });
    const p = await installMojangRuntime(component, RUNTIME_DIR,
      (d, t) => send('java:progress', { pct: Math.min(100, Math.round(d / t * 100)), component }));
    if (!p) throw new Error('Не удалось скачать runtime с серверов Mojang');
    send('java:progress', { pct: 100, component });
    return { ok: true, path: p, major: javaMajorVersion(p), component };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Список доступных для скачивания рантаймов Mojang (для диалога выбора Java).
ipcMain.handle('java:available', async () => {
  try {
    const { listAvailableRuntimes } = require('./src/java');
    return { ok: true, runtimes: await listAvailableRuntimes(RUNTIME_DIR) };
  } catch (e) {
    return { ok: false, error: e.message, runtimes: [] };
  }
});

async function pickUrl(versionId) {
  const list = await getVersionList();
  const v = list.find(x => x.id === versionId);
  if (!v) throw new Error('Версия не найдена');
  return v.url;
}

const LAUNCH_FEATURES = {
  is_demo_user: false,
  has_custom_resolution: true,
  // Quick play: активируем ТОЛЬКО is_quick_play_multiplayer и только когда
  // задан сервер (см. buildLaunchFeatures). Включать все quick-play флаги
  // нельзя — клиент 1.21.11+ падает с "Only one quick play option can be
  // specified", а пустой --quickPlayPath оставляет висячий флаг без значения.
  // Классические --server/--port новые клиенты (26.x+) полностью игнорируют —
  // единственный рабочий способ автоподключения: --quickPlayMultiplayer.
  has_quick_plays_support: false,
  is_quick_play_singleplayer: false,
  is_quick_play_multiplayer: false,
  is_quick_play_realms: false,
};

// Активная конфигурация фич зависит от того, куда заходим.
// serverHost задаётся после SRV-резолва (game:launch).
function buildLaunchFeatures(serverHost) {
  return {
    ...LAUNCH_FEATURES,
    is_quick_play_multiplayer: !!(serverHost && String(serverHost).trim()),
  };
}

// A version can come from piston-meta (versionUrl) or be a locally installed
// loader like Fabric/Forge (has a version.json in .minecraft/versions/<id>).
// Для сборки (instanceId) версия ищется в каталоге этой сборки.
async function resolveSpec(versionUrl, versionId, gameDir, features) {
  const f = features || buildLaunchFeatures(null);
  if (versionUrl) {
    return buildSpec(versionUrl, f);
  }
  const root = gameDir || GAME_DIR;
  const localJson = path.join(root, 'versions', versionId, `${versionId}.json`);
  if (fs.existsSync(localJson)) {
    return buildSpecFromFile(localJson, f);
  }
  const url = await pickUrl(versionId);
  return buildSpec(url, f);
}

// Install Fabric or Forge for the selected Minecraft version (or an instance).
ipcMain.handle('loader:install', async (_e, { kind, gameVersion, instanceId }) => {
  try {
    const gameDir = instanceId ? instances.instanceGameDir(instanceId) : GAME_DIR;
    fs.mkdirSync(gameDir, { recursive: true });
    const res = await installLoader(kind, gameDir, gameVersion,
      stage => send('loader:status', { stage, kind }));
    if (instanceId) {
      const inst = instances.getInstance(instanceId);
      const ver = res.type === 'fabric' ? res.loader : `${gameVersion}-${res.loader}`;
      instances.updateInstance(instanceId, {
        loader: kind, loaderVersion: res.loader, versionId: res.id, mcVersion: gameVersion,
      });
      send('loader:status', { stage: `Сборка «${inst.name}»: ${kind} ${ver} установлен`, kind });
    }
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('game:launch', async (_e, opts) => {
  const { versionUrl, versionId, ramGB, extraJvm, fullscreen, serverIp, javaPath, instanceId } = opts;
  try {
    send('game:status', { stage: 'Получение манифеста версии…', percent: 2 });

    // Быстрый вход: "Epic.servmine.top" -> { host, port } через SRV (25141 у EPIC).
    // Без этого игра всегда стучалась на 25565 и не подключалась к серверу.
    let serverHost = null, serverPort = null;
    if (serverIp && String(serverIp).trim()) {
      try {
        const { resolveAddress } = require('./src/serverping');
        const addr = await resolveAddress(serverIp);
        if (addr) { serverHost = addr.host; serverPort = addr.port; }
      } catch (e) {
        console.warn('[launch] не удалось разрешить адрес сервера:', e.message);
      }
    }

    // Продвинутый режим: играем из каталога сборки (изолированные mods/saves/config),
    // но используем общие libraries/ и assets/ корневого .minecraft.
    let gameDir = GAME_DIR;
    let libsDir = path.join(GAME_DIR, 'libraries');
    let assetsDir = path.join(GAME_DIR, 'assets');
    if (instanceId) {
      const inst = instances.getInstance(instanceId);
      gameDir = instances.instanceGameDir(instanceId);
      fs.mkdirSync(gameDir, { recursive: true });
      ACTIVE_INSTANCE = instanceId;
      send('game:status', { stage: `Сборка «${inst.name}»…`, percent: 2 });
    }

    const spec = await resolveSpec(versionUrl, versionId, instanceId ? gameDir : null,
      buildLaunchFeatures(serverHost));

    // Java: manual selection wins; otherwise auto-pick minimal sufficient runtime
    send('game:status', { stage: `Поиск Java ${spec.javaMajor}+…`, percent: 5 });
    let javaInfo = null;
    try {
      javaInfo = await resolveJava(spec, RUNTIME_DIR, (d, t, name) => {
        send('game:status', { stage: `Загрузка Java-среды (${d}/${t})…`, percent: 5 + Math.round(d / t * 10) });
      }, javaPath || null);
    } catch (e) {
      throw new Error(e.message);
    }

    // Auth
    let acc = auth.holder.load();
    if (!acc) acc = auth.holder.offline(opts.nick || 'Steve');
    if (acc.type === 'microsoft') acc = await auth.holder.ensureValid();

    // Downloads (версии сборки — в gameDir; библиотеки/ассеты — общие)
    const dl = new Downloader(gameDir, prog => {
      const p = 15 + Math.round((prog.percent || 0) * 0.7);
      send('game:status', {
        stage: prog.stage, percent: Math.min(85, p),
        speed: prog.speed, filesDone: prog.filesDone, filesTotal: prog.filesTotal,
      });
    }, { libsDir, assetsDir });
    const paths = await dl.install(spec, s => send('game:status', { stage: s, percent: 86 }));

    // Launch
    send('game:status', { stage: 'Запуск игры…', percent: 92 });
    const cmd = buildArgs(spec, paths, {
      auth: acc, gameDir, javaPath: javaInfo.path,
      ramGB: ramGB || 4, extraJvm: extraJvm || '', fullscreen,
      serverIp: serverHost, serverPort, librariesDir: libsDir,
    });

    currentChild = launch(cmd, gameDir,
      text => send('game:log', text.slice(0, 2000)),
      ({ code, error }) => {
        currentChild = null;
        send('game:exit', { code, error: error || null });
      });

    if (instanceId) instances.touch(instanceId);
    send('game:status', { stage: 'Игра запущена!', percent: 100 });
    return { ok: true, java: javaInfo.path, source: javaInfo.source, version: spec.id, natives: paths.nativesDir };
  } catch (e) {
    console.error('[launch-error]', e);
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('game:kill', async () => {
  if (currentChild && currentChild.pid) {
    try {
      if (process.platform === 'win32') {
        // На Windows убиваем весь процесс-дерево (java может порождать дочерние)
        require('child_process').execFileSync('taskkill', ['/PID', String(currentChild.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try { process.kill(-currentChild.pid, 'SIGTERM'); } catch { try { currentChild.kill('SIGTERM'); } catch {} }
      }
    } catch (e) {
      try { currentChild.kill('SIGTERM'); } catch {}
    }
  }
  return { ok: true };
});

ipcMain.handle('paths:open', async (_e, instanceId) => {
  const dir = instanceId ? instances.instanceGameDir(instanceId) : GAME_DIR;
  shell.openPath(dir);
  return dir;
});
ipcMain.handle('paths:gameDir', async (_e, instanceId) => {
  return instanceId ? instances.instanceGameDir(instanceId) : GAME_DIR;
});

/* ---------------- Сборки (instances, продвинутый режим) ---------------- */

ipcMain.handle('instances:list', async () => {
  try { return instances.listInstances(); } catch (e) { return []; }
});

ipcMain.handle('instances:get', async (_e, id) => {
  try { return instances.getInstance(id); } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('instances:create', async (_e, opts) => {
  try {
    const inst = instances.createInstance(opts);
    return { ok: true, instance: inst };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('instances:update', async (_e, { id, ...patch }) => {
  try {
    const inst = instances.updateInstance(id, patch);
    return { ok: true, instance: inst };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('instances:delete', async (_e, id) => {
  try {
    const ok = instances.deleteInstance(id);
    if (ACTIVE_INSTANCE === id) ACTIVE_INSTANCE = null;
    return { ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('instances:duplicate', async (_e, { id, name }) => {
  try {
    const inst = instances.duplicateInstance(id, name);
    return { ok: true, instance: inst };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('instances:export', async (_e, { id, destPath }) => {
  try {
    const file = instances.exportInstance(id, destPath);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('instances:import', async (_e, { zipPath, name }) => {
  try {
    const inst = instances.importInstance(zipPath, name);
    return { ok: true, instance: inst };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Minecraft server-list ping: returns {ok, ms, online, max}
// Адрес разрешается через SRV-запись (_minecraft._tcp.<host>) — иначе серверы с
// нестандартным портом (например, EPIC: 25141) всегда показывались офлайн.
ipcMain.handle('server:ping', async (_e, host) => {
  const { pingServer } = require('./src/serverping');
  const start = Date.now();
  const r = await pingServer(host, null, 5000);
  return r.ok ? { ok: true, ms: Date.now() - start, online: r.online, max: r.max } : { ok: false };
});

// Вписать сервера в servers.dat (меню мультиплеера игры).
// Принимает только те сервера, что пользователь добавил сам.
ipcMain.handle('servers:sync', async (_e, userServers) => {
  const { syncServersDat } = require('./src/serversio');
  const list = Array.isArray(userServers) && userServers.length
    ? userServers.filter(s => s && s.ip)
    : [{ name: '🔥 EPIC', ip: 'Epic.servmine.top' }];
  try {
    const n = syncServersDat(GAME_DIR, list,
      stage => send('servers:status', { stage }));
    return { ok: true, count: n, file: path.join(GAME_DIR, 'servers.dat') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* ---------------- Моды (Modrinth) ---------------- */

const MODS_DIR = (instanceId) => instanceId
  ? path.join(instances.instanceGameDir(instanceId), 'mods')
  : path.join(GAME_DIR, 'mods');

ipcMain.handle('mods:search', async (_e, { source, query, gameVersion }) => {
  try {
    const { searchMods } = require('./src/mods');
    return { ok: true, mods: await searchMods(source || 'modrinth', query || '', gameVersion || null) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// { source, modId, gameVersion, loader, title, slug, instanceId } -> скачивает .jar в mods/ и пишет манифест
ipcMain.handle('mods:download', async (_e, { source, modId, gameVersion, loader, title, slug, instanceId }) => {
  const { modrinthVersionFile, downloadMod, addModManifestEntry } = require('./src/mods');
  try {
    const file = await modrinthVersionFile(modId, gameVersion || null, loader || 'any');
    const dir = MODS_DIR(instanceId);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, file.filename);
    await downloadMod(file.url, dest, pct => send('mods:progress', { pct, filename: file.filename }));
    addModManifestEntry(dir, { source: source || 'modrinth', modId: String(modId), slug: slug || '', title: title || '', filename: file.filename, loader: loader || 'any' });
    return { ok: true, filename: file.filename, loader: file.loader };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Удалить установленный мод из папки mods/
ipcMain.handle('mods:delete', async (_e, filename, instanceId) => {
  const { deleteModFile } = require('./src/mods');
  try {
    deleteModFile(MODS_DIR(instanceId), filename);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// -> { files: ['X.jar',...], manifest: [{source, modId, slug, title, filename}] }
ipcMain.handle('mods:listInstalled', async (_e, instanceId) => {
  try {
    const { readModManifest } = require('./src/mods');
    const dir = MODS_DIR(instanceId);
    if (!fs.existsSync(dir)) return { files: [], manifest: [] };
    const files = fs.readdirSync(dir).filter(f => /\.jar$/i.test(f));
    const manifest = readModManifest(dir).filter(x => files.includes(x.filename));
    return { files, manifest };
  } catch { return { files: [], manifest: [] }; }
});

/* ---------------- Сборки из каталогов (Modrinth / FTB) ---------------- */

ipcMain.handle('modpacks:search', async (_e, { source, query, gameVersion }) => {
  try {
    const { searchModpacks } = require('./src/modpacks');
    const packs = await searchModpacks(source || 'modrinth', query || '', gameVersion || null);
    return { ok: true, packs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// { source: 'modrinth'|'ftb', id, versionId?, name? } — устанавливает сборку:
// каталог instances/<id>/.minecraft + файлы + загрузчик точной версии.
ipcMain.handle('modpacks:install', async (_e, opts) => {
  try {
    const { installModpack } = require('./src/modpacks');
    const inst = await installModpack({
      ...opts,
      onStatus: s => send('modpacks:progress', { stage: s }),
      onProgress: p => send('modpacks:progress', {
        stage: `Файлы сборки (${p.done}/${p.total}): ${p.filename || ''}`,
        pct: p.total ? Math.round(p.done / p.total * 100) : 0,
        done: p.done, total: p.total,
      }),
    });
    return { ok: true, instance: inst };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Импорт локального .mrpack-файла (сборка Modrinth) через диалог выбора файла.
ipcMain.handle('modpacks:import', async () => {
  try {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выберите файл сборки (.mrpack)',
      filters: [
        { name: 'Сборки Modrinth', extensions: ['mrpack'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const { installModrinthMrpack } = require('./src/modpacks');
    const inst = await installModrinthMrpack(r.filePaths[0], {
      onStatus: s => send('modpacks:progress', { stage: s }),
      onProgress: p => send('modpacks:progress', {
        stage: `Файлы сборки (${p.done}/${p.total}): ${p.filename || ''}`,
        pct: p.total ? Math.round(p.done / p.total * 100) : 0,
      }),
    });
    return { ok: true, instance: inst };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* ---------------- Microsoft flow ---------------- */

async function microsoftFlow() {
  return new Promise((resolve) => {
    const finish = (r) => { resolve(r); };
    msWindow = new BrowserWindow({
      width: 520, height: 720, parent: win, modal: true, show: true,
      title: 'Вход Microsoft', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    msWindow.webContents.session.clearStorageItems({ partitions: [] }).catch(() => {});

    let settled = false;
    const onNavigate = (details) => {
      const url = details.url;
      if (!url.startsWith('http://localhost:1066')) return;
      try {
        const u = new URL(url);
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        if (settled) return; settled = true;
        msWindow.close();
        if (err) return finish({ ok: false, error: 'Отказ авторизации: ' + err });
        if (!code) return finish({ ok: false, error: 'Не получен код авторизации' });
        auth.holder.completeWithCode(code)
          .then(a => finish({ ok: true, account: publicAccount(a) }))
          .catch(e => finish({ ok: false, error: friendlyMsError(e) }));
      } catch (e) {
        if (!settled) { settled = true; msWindow.close(); finish({ ok: false, error: e.message }); }
      }
    };

    msWindow.webContents.on('will-navigate', onNavigate);
    msWindow.webContents.on('did-navigate', onNavigate);
    msWindow.webContents.on('did-frame-navigate', (e2, url) => onNavigate({ url }));
    msWindow.once('closed', () => {
      msWindow = null;
      if (!settled) { settled = true; finish({ ok: false, error: 'Окно входа закрыто' }); }
    });

    msWindow.loadURL(auth.holder.startUrl());
  });
}

function friendlyMsError(e) {
  const msg = e.message || '';
  if (/AADB2A9.*consent|interaction_required/i.test(msg)) return 'Нужно подтверждение входа — попробуйте ещё раз.';
  if (/no profile/i.test(msg)) return 'На этом аккаунте нет Minecraft Java Edition.';
  return msg;
}

function publicAccount(a) {
  if (!a) return null;
  return { type: a.type, nick: a.nick, uuid: a.uuid, skins: a.skins || [], capes: a.capes || [] };
}
