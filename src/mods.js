'use strict';
/*
 * Mod repository: search + download from Modrinth.
 * (CurseForge requires a paid/registered API key and cannot be used anonymously,
 *  so it was removed — only Modrinth is supported.)
 */

const fs = require('fs');
const path = require('path');
const { smartFetch } = require('./net');

const UA = 'epic-launcher/2.0.0 (https://github.com/)';

async function jsonFetch(url, opts = {}) {
  const res = await smartFetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

/* ---------------- Modrinth ---------------- */

async function searchModrinth(query, gameVersion) {
  const facets = [['project_type:mod']];
  if (gameVersion && /^\d+(\.\d+)+$/.test(gameVersion)) {
    facets.push([`versions:${gameVersion}`]);
  }
  const url = 'https://api.modrinth.com/v2/search?limit=30&' +
    `query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  let j;
  try {
    j = await jsonFetch(url);
  } catch (e) {
    // Some game versions (snapshots/betas) are not valid Modrinth facets —
    // retry without the version filter so search still works.
    if (gameVersion) return searchModrinth(query, null);
    throw e;
  }
  return (j.hits || []).map(h => ({
    source: 'modrinth', id: h.project_id, slug: h.slug, title: h.title,
    description: h.description || '', downloads: h.downloads || 0,
    versions: (h.versions || []).slice(0, 5), iconUrl: h.icon_url || null,
    loaders: (h.categories || []).filter(c => ['fabric', 'forge', 'quilt', 'neoforge', 'liteloader'].includes(c)),
  }));
}

// Resolve the best version file for a project: pick first compatible with
// gameVersion and (optionally) a specific mod loader (fabric/forge/quilt/...).
async function modrinthVersionFile(projectId, gameVersion, loader) {
  const url = `https://api.modrinth.com/v2/project/${projectId}/version`;
  const versions = await jsonFetch(url);
  const pick = pickModVersion(versions, gameVersion, loader);
  if (!pick) {
    throw new Error(loader
      ? `У проекта нет версий для ${gameVersion} (${loader})`
      : 'У проекта нет версий');
  }
  const primary = (pick.files || []).find(f => f.primary) || (pick.files || [])[0];
  if (!primary) throw new Error('Нет файла для скачивания');
  return { url: primary.url, filename: primary.filename, loader: pick.loaders || [] };
}

function pickModVersion(versions, gameVersion, loader) {
  if (!versions || !versions.length) return null;
  let list = versions;
  if (gameVersion && /^\d+(\.\d+)+$/.test(gameVersion)) {
    list = list.filter(v => (v.game_versions || []).includes(gameVersion));
  }
  if (loader && loader !== 'any') {
    const matchLoader = list.filter(v => (v.loaders || []).includes(loader));
    if (matchLoader.length) list = matchLoader;
  }
  return list[0] || null;
}

/* ---------------- Download ---------------- */

async function downloadMod(url, dest, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const res = await smartFetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const total = +(res.headers.get('content-length') || 0);
  let done = 0;
  const ws = fs.createWriteStream(tmp);
  for await (const chunk of res.body) {
    ws.write(chunk);
    done += chunk.length;
    if (onProgress) onProgress(total ? Math.round(done / total * 100) : -1);
  }
  await new Promise(r => ws.end(r));
  fs.renameSync(tmp, dest);
  return dest;
}

async function searchMods(source, query, gameVersion) {
  return searchModrinth(query, gameVersion);
}

// Удалить установленный мод (.jar в папке mods/). Безопасно: удаляет только файл.
function deleteModFile(modsDir, filename) {
  if (!/\.jar$/i.test(filename)) throw new Error('Некорректное имя файла');
  const target = path.join(modsDir, filename);
  if (!fs.existsSync(target)) throw new Error('Мод не найден: ' + filename);
  fs.unlinkSync(target);
  return true;
}

module.exports = { searchMods, searchModrinth, modrinthVersionFile, downloadMod, pickModVersion, deleteModFile };
