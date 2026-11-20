'use strict';
/*
 * Проверка обновлений из GitHub Releases репозитория лаунчера
 * (https://github.com/kitlit73/EPIC_Launcher) и установка по кнопке.
 *
 * Логика:
 *   - GET /releases/latest (GitHub API, без auth — репозиторий публичный);
 *   - сравнение версий (числовой semver-подобный, 'v'-префикс игнорируется);
 *   - если новее — берём .exe-ассет (приоритет NSIS Setup, иначе portable);
 *   - установка: скачивание в temp + запуск установщика detached,
 *     лаунчер закрывается (установщик NSIS сам закроет оставшийся процесс).
 *
 * Модуль не зависит от Electron (smartFetch сам выбирает net.fetch под
 * Electron — важно: api.github.com и CDN релизов могут быть доступны
 * только через системный прокси).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { smartFetch } = require('./net');

const RELEASES_API = 'https://api.github.com/repos/kitlit73/EPIC_Launcher/releases/latest';
const UA = 'epic-launcher/1.0.0 (github.com/kitlit73/EPIC_Launcher)';

/** "v1.2.3-beta.4" -> [1,2,3]; без prerelease-сравнения (не используется). */
function parseVersion(s) {
  const m = String(s || '').trim().replace(/^v/i, '').match(/\d+(?:\.\d+)*/);
  return m ? m[0].split('.').map(Number) : null;
}

/** remote новее, чем local? */
function isNewer(remote, local) {
  const r = parseVersion(remote), l = parseVersion(local);
  if (!r) return false;
  if (!l) return true;
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const a = r[i] || 0, b = l[i] || 0;
    if (a !== b) return a > b;
  }
  return false;
}

/**
 * Проверить обновление.
 * Возвращает { ok, update, current, latest, url?, asset?: {name, url, size} }.
 */
async function checkUpdate(currentVersion) {
  const res = await smartFetch(RELEASES_API, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) {
    // Релизов ещё нет — обновления нет.
    return { ok: true, update: false, current: currentVersion, latest: null };
  }
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  const j = await res.json();
  const latest = j.tag_name || j.name || '';
  if (!isNewer(latest, currentVersion)) {
    return { ok: true, update: false, current: currentVersion, latest };
  }
  const assets = j.assets || [];
  const asset =
    assets.find(a => /setup/i.test(a.name) && a.name.toLowerCase().endsWith('.exe')) ||
    assets.find(a => a.name.toLowerCase().endsWith('.exe')) ||
    null;
  return {
    ok: true,
    update: true,
    current: currentVersion,
    latest,
    url: j.html_url,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size || 0 } : null,
  };
}

/** Скачать ассет обновления в dest (с прогрессом байтов). */
async function downloadUpdate(url, dest, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const res = await smartFetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const total = +(res.headers.get('content-length') || 0);
  let done = 0;
  const ws = fs.createWriteStream(tmp);
  try {
    for await (const chunk of res.body) {
      ws.write(chunk);
      done += chunk.length;
      if (onProgress) onProgress(total ? Math.round(done / total * 100) : -1, done, total);
    }
  } finally {
    ws.end();
    await new Promise(r => ws.on('close', r));
  }
  fs.rmSync(dest, { force: true });
  fs.renameSync(tmp, dest);
  return dest;
}

/** Запустить установщик (NSIS сам спросит/закроет запущенный лаунчер). */
function runUpdate(installerPath) {
  const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
  child.unref();
  return true;
}

module.exports = { checkUpdate, downloadUpdate, runUpdate, isNewer, parseVersion };
