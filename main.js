'use strict';
/*
 * EPIC Launcher — Electron main process.
 * Real Minecraft downloading (piston-meta), Mojang Java runtime handling,
 * Microsoft / offline auth and actual game launch.
 */

const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

const { getVersionList, buildSpec } = require('./src/manifest');
const { Downloader } = require('./src/downloader');
const { resolveJava, listInstalledJava } = require('./src/java');
const { Auth } = require('./src/auth');
const { buildArgs, launch } = require('./src/launcher');

let GAME_DIR = '';   // .minecraft root
let RUNTIME_DIR = '';// extracted Mojang JREs

let win = null;
let currentChild = null;
let msWindow = null;
const auth = { holder: null };

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 980, minHeight: 640,
    backgroundColor: '#0b1020', autoHideMenuBar: true, icon: path.join(__dirname, 'assets', 'icon.png'),
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
  auth.holder = new Auth(GAME_DIR);

  try { session.defaultSession.clearCache(); } catch {}

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

ipcMain.handle('account:offline', async (_e, nick) => {
  const a = auth.holder.offline(String(nick || 'Steve').slice(0, 16));
  return publicAccount(a);
});

ipcMain.handle('account:microsoft', async () => {
  return microsoftFlow();
});

ipcMain.handle('account:get', async () => publicAccount(auth.holder.load()));

ipcMain.handle('account:logout', async () => { auth.holder.clear(); return { ok: true }; });

// All installed JREs/JDKs (system + launcher-downloaded) for the Java dropdown
ipcMain.handle('java:list', async () => {
  try { return listInstalledJava(RUNTIME_DIR); } catch (e) { console.error('[java:list]', e); return []; }
});

// Explicitly download the official Mojang runtime for the chosen version
ipcMain.handle('java:download', async (_e, opts) => {
  const { installMojangRuntime, javaMajorVersion } = require('./src/java');
  try {
    let major = null, component = 'java-runtime-delta';
    try {
      const spec = await buildSpec(opts.versionUrl || (await pickUrl(opts.versionId)));
      major = spec.javaMajor; component = spec.javaComponent || component;
    } catch {}
    send('game:status', { stage: 'Скачивание Java…', percent: 5 });
    const p = await installMojangRuntime(component, RUNTIME_DIR,
      (d, t) => send('game:status', { stage: `Загрузка Java (${d}/${t})`, percent: 5 + Math.round(d / t * 10) }));
    if (!p) throw new Error('Не удалось скачать runtime с серверов Mojang');
    return { ok: true, path: p, major: javaMajorVersion(p) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

async function pickUrl(versionId) {
  const list = await getVersionList();
  const v = list.find(x => x.id === versionId);
  if (!v) throw new Error('Версия не найдена');
  return v.url;
}

ipcMain.handle('game:launch', async (_e, opts) => {
  const { versionUrl, versionId, ramGB, extraJvm, fullscreen, serverIp, javaPath } = opts;
  try {
    send('game:status', { stage: 'Получение манифеста версии…', percent: 2 });

    const spec = await buildSpec(versionUrl);

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

    // Downloads
    const dl = new Downloader(GAME_DIR, prog => {
      const p = 15 + Math.round((prog.percent || 0) * 0.7);
      send('game:status', {
        stage: prog.stage, percent: Math.min(85, p),
        speed: prog.speed, filesDone: prog.filesDone, filesTotal: prog.filesTotal,
      });
    });
    const paths = await dl.install(spec, s => send('game:status', { stage: s, percent: 86 }));

    // Launch
    send('game:status', { stage: 'Запуск игры…', percent: 92 });
    const cmd = buildArgs(spec, paths, {
      auth: acc, gameDir: GAME_DIR, javaPath: javaInfo.path,
      ramGB: ramGB || 4, extraJvm: extraJvm || '', fullscreen, serverIp,
    });

    currentChild = launch(cmd, GAME_DIR,
      text => send('game:log', text.slice(0, 2000)),
      ({ code, error }) => {
        currentChild = null;
        send('game:exit', { code, error: error || null });
      });

    send('game:status', { stage: 'Игра запущена!', percent: 100 });
    return { ok: true, java: javaInfo.path, source: javaInfo.source, version: spec.id, natives: paths.nativesDir };
  } catch (e) {
    console.error('[launch-error]', e);
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('game:kill', async () => {
  if (currentChild) { try { currentChild.kill('SIGTERM'); } catch {} }
  return { ok: true };
});

ipcMain.handle('paths:open', async () => { shell.openPath(GAME_DIR); return GAME_DIR; });
ipcMain.handle('paths:gameDir', async () => GAME_DIR);

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
