'use strict';
/*
 * Каталоги сборок (modpacks): Modrinth (.mrpack) и FTB (api.feed-the-beast.com).
 *
 * Modrinth: поиск project_type:modpack -> версии проекта -> .mrpack архив
 *   (modrinth.index.json: dependencies, files[] с sha1 и прямыми ссылками,
 *    overrides/ + client-overrides/ распаковываются в каталог игры).
 *
 * FTB: официальный API (schema modpacks.ch, база api.feed-the-beast.com/v1/modpacks):
 *   search/{limit}?term=... -> id-шники; /public/modpack/{id} -> инфо+версии;
 *   /public/modpack/{id}/{version} -> targets[] (minecraft/загрузчик) и files[]
 *   (прямые ссылки files.feed-the-beast.com, path=папка, name=файл, sha1).
 *
 * Установка сборки = создать instances/<id>/ + скачать файлы + установить
 * загрузчик точной версии через loaders.installLoader.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { sha1File } = require('./downloader');
const { installLoader } = require('./loaders');
const { smartFetch } = require('./net');
const instances = require('./instances');

const UA = 'epic-launcher/2.0.0 (https://github.com/)';
const MODRINTH_API = 'https://api.modrinth.com/v2';
const FTB_BASE = 'https://api.feed-the-beast.com/v1/modpacks';

async function jsonFetch(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await smartFetch(url, { headers: { 'User-Agent': UA } });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!res.ok) {
        const err = new Error(data.error || data.message || `HTTP ${res.status}`);
        err.status = res.status; throw err;
      }
      return data;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/** Скачивание файла с UA, .part-файлом, проверкой sha1 и прогрессом байтов. */
async function downloadFile(url, dest, expectedSha, onBytes, headers = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  let res;
  for (let i = 0; i < 3; i++) {
    try { res = await smartFetch(url, { headers: { 'User-Agent': UA, ...headers } }); break; }
    catch (e) { if (i === 2) throw e; await new Promise(r => setTimeout(r, 800 * Math.pow(2, i))); }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const ws = fs.createWriteStream(tmp);
  try {
    for await (const chunk of res.body) ws.write(chunk), onBytes && onBytes(chunk.length);
  } finally {
    ws.end();
    await new Promise(r => ws.on('close', r));
  }
  if (expectedSha) {
    const got = await sha1File(tmp);
    if (got !== expectedSha) { fs.rmSync(tmp, { force: true }); throw new Error(`SHA1 не совпал (${path.basename(dest)})`); }
  }
  fs.rmSync(dest, { force: true });
  fs.renameSync(tmp, dest);
  return dest;
}

/** Безопасный путь внутри каталога игры (защита от ../ в архивах/индексах). */
function safeJoin(gameDir, rel) {
  const dest = path.resolve(gameDir, rel);
  const root = path.resolve(gameDir);
  if (dest !== root && !dest.startsWith(root + path.sep)) return null;
  return dest;
}

/** Создать сборку с уникальным именем (name, name (2), name (3)...). */
function createUniqueInstance(opts) {
  let name = String(opts.name || 'Сборка из каталога').trim() || 'Сборка из каталога';
  for (let n = 0; n < 20; n++) {
    try {
      return instances.createInstance({ ...opts, name: n ? `${name} (${n + 1})` : name });
    } catch (e) {
      if (!/уже существует/.test(e.message)) throw e;
    }
  }
  throw new Error('Не удалось подобрать имя сборки');
}

/* ================= Modrinth ================= */

async function searchModrinthPacks(query, gameVersion) {
  const facets = [['project_type:modpack']];
  if (gameVersion && /^\d+(\.\d+)+$/.test(gameVersion)) facets.push([`versions:${gameVersion}`]);
  const url = `${MODRINTH_API}/search?limit=24&index=downloads&` +
    `query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  let j;
  try {
    j = await jsonFetch(url);
  } catch (e) {
    if (gameVersion) return searchModrinthPacks(query, null); // снапшоты не валидны как фасет
    throw e;
  }
  return (j.hits || []).map(h => ({
    source: 'modrinth', id: h.project_id, slug: h.slug, title: h.title,
    description: h.description || '', downloads: h.downloads || 0,
    mcVersions: (h.versions || []).slice(0, 8), iconUrl: h.icon_url || null,
    loaders: (h.categories || []).filter(c => ['fabric', 'forge', 'quilt', 'neoforge'].includes(c)),
  }));
}

async function modrinthPackVersions(projectId) {
  const versions = await jsonFetch(`${MODRINTH_API}/project/${projectId}/version`);
  return (versions || []).map(v => {
    const primary = (v.files || []).find(f => f.primary) || (v.files || [])[0];
    return {
      id: v.id, name: v.name || v.version_number, versionNumber: v.version_number,
      mcVersions: v.game_versions || [], loaders: v.loaders || [],
      date: v.date_published, filename: primary && primary.filename,
    };
  });
}

function pickMrpackFile(version) {
  const primary = (version.files || []).find(f => f.primary) || (version.files || [])[0];
  if (!primary) throw new Error('У версии сборки нет файла');
  return primary;
}

/** Зависимости -> {loader, loaderVersion} (fabric/forge/neoforge/quilt/vanilla). */
function depsToLoader(deps) {
  const d = deps || {};
  if (d['fabric-loader']) return { loader: 'fabric', loaderVersion: d['fabric-loader'] };
  if (d['quilt-loader']) return { loader: 'quilt', loaderVersion: d['quilt-loader'] };
  if (d['neoforge']) return { loader: 'neoforge', loaderVersion: d['neoforge'] };
  if (d.forge) return { loader: 'forge', loaderVersion: d.forge };
  return { loader: 'vanilla', loaderVersion: null };
}

/** Распаковать overrides/ + client-overrides/ в каталог игры сборки. */
function extractMrpackOverrides(zip, gameDir) {
  let count = 0;
  for (const dir of ['overrides', 'client-overrides']) { // client-overrides главнее
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(dir + '/')) continue;
      const rel = e.entryName.slice(dir.length + 1);
      const dest = safeJoin(gameDir, rel);
      if (!dest) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
      count++;
    }
  }
  return count;
}

/** Скачать все файлы из modrinth.index.json (клиентские) с прогрессом. */
async function installMrpackFiles(index, gameDir, onProgress) {
  const files = (index.files || []).filter(f => f && f.path && f.downloads && f.downloads.length);
  let done = 0;
  const total = files.length;
  for (const f of files) {
    const env = f.env || {};
    if (env.client === 'unsupported') { done++; continue; }
    const dest = safeJoin(gameDir, f.path);
    if (dest) {
      let ok = false;
      if (fs.existsSync(dest) && f.hashes && f.hashes.sha1) {
        try { ok = (await sha1File(dest)) === f.hashes.sha1; } catch {}
      }
      if (!ok) {
        await downloadFile(f.downloads[0], dest, f.hashes && f.hashes.sha1);
      }
    }
    done++;
    onProgress && onProgress({ done, total, filename: path.basename(f.path) });
  }
  return { done, total };
}

/**
 * Установить сборку Modrinth из .mrpack-архива.
 * Возвращает метаданные созданной сборки.
 */
async function installModrinthMrpack(mrpackPath, { name, onStatus, onProgress } = {}) {
  if (!fs.existsSync(mrpackPath)) throw new Error('Файл не найден: ' + mrpackPath);
  onStatus && onStatus('Чтение архива сборки…');
  const zip = new AdmZip(mrpackPath);
  const idxEntry = zip.getEntry('modrinth.index.json');
  if (!idxEntry) throw new Error('Это не сборка Modrinth (.mrpack): нет modrinth.index.json');
  const index = JSON.parse(idxEntry.getData().toString('utf8'));
  const mc = (index.dependencies || {}).minecraft;
  if (!mc) throw new Error('В modrinth.index.json нет версии Minecraft');
  const { loader, loaderVersion } = depsToLoader(index.dependencies);

  onStatus && onStatus(`Создание сборки «${index.name || name || 'Modrinth'}»…`);
  const inst = createUniqueInstance({
    name: name || index.name || 'Modrinth сборка',
    mcVersion: mc, loader, icon: '📦',
    ramGB: 4,
  });
  const gameDir = instances.instanceGameDir(inst.id);

  onStatus && onStatus('Распаковка конфигов и оверрайдов…');
  extractMrpackOverrides(zip, gameDir);

  onStatus && onStatus(`Загрузка файлов сборки (${(index.files || []).length})…`);
  await installMrpackFiles(index, gameDir, onProgress);

  if (loader !== 'vanilla') {
    onStatus && onStatus(`Установка ${loader} ${loaderVersion || ''} (${mc})…`);
    const res = await installLoader(loader, gameDir, mc, s => onStatus && onStatus(s), { version: loaderVersion });
    instances.updateInstance(inst.id, { versionId: res.id, loaderVersion: res.loader });
  }
  const fresh = instances.getInstance(inst.id);
  onStatus && onStatus(`Сборка «${fresh.name}» установлена`);
  return fresh;
}

/** Установить сборку Modrinth по id проекта (последняя совместимая версия). */
async function installModrinthPack({ projectId, versionId, name, onStatus, onProgress } = {}) {
  onStatus && onStatus('Получение версий сборки…');
  const versions = await modrinthPackVersions(projectId);
  if (!versions.length) throw new Error('У сборки нет версий');
  let v = versionId ? versions.find(x => x.id === versionId) : null;
  if (!v) {
    const rel = versions.filter(x => (x.loaders || []).some(l => ['fabric', 'forge', 'quilt', 'neoforge'].includes(l)));
    v = (rel.length ? rel : versions)[0];
  }
  onStatus && onStatus(`Скачивание архива «${v.name}»…`);
  const full = await jsonFetch(`${MODRINTH_API}/project/${projectId}/version`);
  const ver = full.find(x => x.id === v.id) || full[0];
  const file = pickMrpackFile(ver);
  const tmp = path.join(instances.root(), `.mrpack-${Date.now()}.mrpack`);
  try {
    let bytes = 0;
    await downloadFile(file.url, tmp, file.hashes && file.hashes.sha1,
      b => onProgress && onProgress({ stage: 'mrpack', done: bytes += b, total: file.size || 0, filename: file.filename }));
    return await installModrinthMrpack(tmp, { name, onStatus, onProgress });
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}

/* ================= FTB ================= */

const ftbPackCache = new Map(); // id -> pack info

async function searchFtbPacks(query, limit = 18) {
  const term = String(query || '').trim();
  if (!term) return []; // у FTB пустой поиск не поддерживается
  const j = await jsonFetch(`${FTB_BASE}/public/modpack/search/${limit}?term=${encodeURIComponent(term)}`);
  const ids = (j && j.packs) || [];
  const out = [];
  for (const id of ids) { // последовательно, аккуратно к API
    try {
      const p = await ftbPackInfo(id);
      if (p) out.push(p);
    } catch {}
  }
  return out;
}

async function ftbPackInfo(id) {
  if (ftbPackCache.has(id)) return ftbPackCache.get(id);
  const j = await jsonFetch(`${FTB_BASE}/public/modpack/${id}`);
  const icon = (j.art || []).find(a => a.type === 'square') || (j.art || [])[0];
  const p = {
    source: 'ftb', id: j.id, title: j.name,
    description: j.synopsis || j.description || '',
    downloads: j.installs || 0,
    iconUrl: (icon && icon.url) || null,
    mcVersions: [...new Set((j.versions || []).map(v => (v.targets || []).find(t => t.name === 'minecraft')?.version).filter(Boolean))].slice(0, 8),
    loaders: [...new Set((j.versions || []).map(v => (v.targets || []).find(t => t.name === 'forge' || t.name === 'fabric' || t.name === 'neoforge')?.name).filter(Boolean))],
    versions: (j.versions || []).map(v => ({ id: v.id, name: v.name, type: v.type, updated: v.updated })),
  };
  ftbPackCache.set(id, p);
  return p;
}

async function ftbVersionManifest(packId, versionId) {
  return jsonFetch(`${FTB_BASE}/public/modpack/${packId}/${versionId}`);
}

function ftbPickVersion(pack, versionId) {
  const list = (pack.versions || []).filter(v => !v.private);
  if (!list.length) throw new Error('У сборки FTB нет доступных версий');
  let v = versionId ? list.find(x => String(x.id) === String(versionId)) : null;
  if (!v) v = [...list].sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  return v;
}

/** Установить сборку FTB по id сборки (последняя версия). */
async function installFtbPack({ packId, versionId, name, onStatus, onProgress } = {}) {
  onStatus && onStatus('Получение информации о сборке…');
  const pack = await ftbPackInfo(packId);
  const ver = ftbPickVersion(pack, versionId);
  onStatus && onStatus(`Манифест версии ${ver.name}…`);
  const manifest = await ftbVersionManifest(packId, ver.id);

  const targets = manifest.targets || [];
  const mcT = targets.find(t => t.name === 'minecraft');
  const ldT = targets.find(t => ['forge', 'fabric', 'neoforge', 'quilt'].includes(t.name));
  const mc = mcT && mcT.version;
  if (!mc) throw new Error('В манифесте FTB нет версии Minecraft');

  const loader = ldT ? ldT.name : 'vanilla';
  const loaderVersion = ldT ? ldT.version : null;
  const ramGB = manifest.specs && manifest.specs.recommended
    ? Math.max(2, Math.min(12, Math.round(manifest.specs.recommended / 1024))) : 4;

  const inst = createUniqueInstance({ name: name || pack.title, mcVersion: mc, loader, icon: '🧱', ramGB });
  const gameDir = instances.instanceGameDir(inst.id);

  // Файлы версии: path=папка (./config/ae2), name=файл; пропускаем серверные.
  const files = (manifest.files || []).filter(f => f && f.url && !f.serveronly);
  let done = 0;
  const total = files.length;
  if (total) onStatus && onStatus(`Загрузка файлов сборки (${total})…`);
  for (const f of files) {
    // иногда путь уже содержит имя файла
    const rel = String(f.path || '').replace(/^\.\//, '').replace(/\\/g, '/');
    const joined = rel.endsWith('/' + f.name) ? rel : (rel.replace(/\/$/, '') + '/' + f.name);
    const dest = safeJoin(gameDir, joined);
    if (dest) {
      let ok = false;
      if (fs.existsSync(dest) && f.sha1) {
        try { ok = (await sha1File(dest)) === f.sha1; } catch {}
      }
      if (!ok) await downloadFile(f.url, dest, f.sha1 || null);
    }
    done++;
    onProgress && onProgress({ done, total, filename: f.name });
  }

  if (loader !== 'vanilla') {
    onStatus && onStatus(`Установка ${loader} ${loaderVersion || ''} (${mc})…`);
    const res = await installLoader(loader, gameDir, mc, s => onStatus && onStatus(s), { version: loaderVersion });
    instances.updateInstance(inst.id, { versionId: res.id, loaderVersion: res.loader });
  }
  const fresh = instances.getInstance(inst.id);
  onStatus && onStatus(`Сборка «${fresh.name}» установлена`);
  return fresh;
}

/* ================= Импорт .zip ================= */

/** Распаковать файлы из префикса архива в destDir (safeJoin, рекурсивно создаёт папки). */
function extractZipPrefix(zip, prefix, destDir) {
  let count = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
    const rel = e.entryName.slice(prefix.length);
    if (!rel) continue;
    const dest = safeJoin(destDir, rel);
    if (!dest) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
    count++;
  }
  return count;
}

/** Распарсить id из version.json: vanilla/fabric/forge/neoforge/quilt. */
function parseVersionId(id) {
  const s = String(id || '');
  let m = /^fabric-loader-([\d.]+)-(\d+(?:\.\d+)*)$/i.exec(s);
  if (m) return { loader: 'fabric', loaderVersion: m[1], mcVersion: m[2] };
  m = /^quilt-loader-([\w.\-]+)-(\d+(?:\.\d+)*)$/i.exec(s);
  if (m) return { loader: 'quilt', loaderVersion: m[1], mcVersion: m[2] };
  m = /^(\d+(?:\.\d+)*)-forge-([\w.\-]+)$/i.exec(s);
  if (m) return { loader: 'forge', loaderVersion: m[2], mcVersion: m[1] };
  m = /^(\d+(?:\.\d+)*)-neoforge-([\w.\-]+)$/i.exec(s);
  if (m) return { loader: 'neoforge', loaderVersion: m[2], mcVersion: m[1] };
  m = /^(\d+(?:\.\d+)*)$/i.exec(s);
  if (m) return { loader: 'vanilla', loaderVersion: null, mcVersion: m[1] };
  return null;
}

/**
 * Импорт сборки из .zip. Поддерживаются:
 *  1) экспорт EPIC Launcher (instance/instance.json) — точная копия сборки;
 *  2) CurseForge (manifest.json + overrides/) — оверрайды + загрузчик + моды
 *     через публичное зеркало CFWidget (api.curse.tools, без ключа API);
 *  3) общий zip с .minecraft/ внутри (MultiMC/Prism: mmc-pack.json) или с
 *     version.json где-либо — определяется версия Minecraft и загрузчик.
 */
async function importPackZip(zipPath, { name, onStatus, onProgress } = {}) {
  if (!fs.existsSync(zipPath)) throw new Error('Файл не найден: ' + zipPath);
  onStatus && onStatus('Чтение архива…');
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(e => !e.isDirectory);

  // 1) Экспорт EPIC Launcher
  if (zip.getEntry('instance/instance.json')) {
    onStatus && onStatus('Сборка EPIC Launcher — импорт…');
    const inst = instances.importInstance(zipPath, name);
    onStatus && onStatus(`Сборка «${inst.name}» импортирована`);
    return inst;
  }

  // 2) CurseForge
  const cfEntry = zip.getEntry('manifest.json');
  if (cfEntry) {
    let manifest;
    try { manifest = JSON.parse(cfEntry.getData().toString('utf8')); } catch {}
    if (manifest && String(manifest.manifestType || '').includes('minecraftModpack')) {
      return installCurseforgeZip(zip, manifest, { name, onStatus, onProgress });
    }
  }

  // 3) Общий zip: определяем корень контента
  const names = entries.map(e => e.entryName.replace(/\\/g, '/'));
  if (!names.length) throw new Error('Архив пуст');
  const tops = [...new Set(names.map(n => n.split('/')[0]))];
  let prefix = tops.length === 1 ? tops[0] + '/' : '';
  let inner = names.map(n => (prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n)).filter(Boolean);
  let contentPrefix = prefix;
  if (inner.some(n => n.startsWith('.minecraft/'))) {
    contentPrefix = prefix + '.minecraft/';
  } else if (inner.every(n => n.startsWith('overrides/')) && inner.length) {
    contentPrefix = prefix + 'overrides/';
  }

  // Версия/загрузчик: mmc-pack.json (MultiMC/Prism) или version.json где угодно
  let meta = null;
  const mmcEntry = zip.getEntry(contentPrefix + 'mmc-pack.json') ||
    entries.find(e => e.entryName.replace(/\\/g, '/').endsWith('/mmc-pack.json'));
  if (mmcEntry) {
    try {
      const j = JSON.parse(mmcEntry.getData().toString('utf8'));
      const comps = j.components || [];
      const mcC = comps.find(c => c.uid === 'net.minecraft');
      const forgeC = comps.find(c => c.uid === 'net.minecraftforge');
      const fabricC = comps.find(c => c.uid === 'net.fabricmc.fabric-loader');
      const quiltC = comps.find(c => c.uid === 'net.quiltmc.quilt-loader');
      const neoC = comps.find(c => c.uid === 'net.neoforged');
      if (mcC && mcC.version) {
        meta = {
          mcVersion: String(mcC.version),
          loader: forgeC ? 'forge' : fabricC ? 'fabric' : neoC ? 'neoforge' : quiltC ? 'quilt' : 'vanilla',
          loaderVersion: (forgeC || fabricC || neoC || quiltC || {}).version || null,
        };
      }
    } catch {}
  }
  if (!meta) {
    const vEntry = entries.find(e => e.entryName.replace(/\\/g, '/').endsWith('/version.json'));
    if (vEntry) {
      try { meta = parseVersionId(JSON.parse(vEntry.getData().toString('utf8')).id); } catch {}
    }
  }
  if (!meta) {
    throw new Error('Не удалось определить версию Minecraft из архива. ' +
      'Поддерживаются: экспорт EPIC Launcher (.zip), .mrpack, CurseForge (.zip с manifest.json), MultiMC/Prism (.zip с mmc-pack.json).');
  }

  const packName = name || (tops.length === 1 ? tops[0] : 'Импортированная сборка');
  onStatus && onStatus(`Создание сборки «${packName}»…`);
  const inst = createUniqueInstance({ name: packName, mcVersion: meta.mcVersion, loader: meta.loader, icon: '📁', ramGB: 4 });
  const gameDir = instances.instanceGameDir(inst.id);

  onStatus && onStatus('Распаковка файлов сборки…');
  const extracted = extractZipPrefix(zip, contentPrefix, gameDir);
  onProgress && onProgress({ done: extracted, total: extracted, filename: '' });

  if (meta.loader !== 'vanilla') {
    onStatus && onStatus(`Установка ${meta.loader} ${meta.loaderVersion || ''} (${meta.mcVersion})…`);
    const res = await installLoader(meta.loader, gameDir, meta.mcVersion, s => onStatus && onStatus(s), { version: meta.loaderVersion });
    instances.updateInstance(inst.id, { versionId: res.id, loaderVersion: res.loader });
  }
  const fresh = instances.getInstance(inst.id);
  onStatus && onStatus(`Сборка «${fresh.name}» установлена`);
  return fresh;
}

/** Импорт CurseForge .zip: overrides + загрузчик + моды через CFWidget. */
async function installCurseforgeZip(zip, manifest, { name, onStatus, onProgress } = {}) {
  const mc = manifest.minecraft && manifest.minecraft.version;
  if (!mc) throw new Error('В manifest.json нет версии Minecraft');
  const modLoaders = (manifest.minecraft.modLoaders || []).map(x => String(x.id || '')).filter(Boolean);
  const ld = modLoaders.find(s => /^forge-/i.test(s)) || modLoaders.find(s => /^neoforge-/i.test(s)) ||
    modLoaders.find(s => /^fabric-/i.test(s)) || modLoaders.find(s => /^quilt-/i.test(s)) || '';
  const loader = ld ? (/^forge/i.test(ld) ? 'forge' : /^neoforge/i.test(ld) ? 'neoforge' : /^fabric/i.test(ld) ? 'fabric' : 'quilt') : 'vanilla';
  const loaderVersion = ld ? ld.replace(/^[\w]+-/i, '') : null;

  const packName = name || manifest.name || 'CurseForge сборка';
  onStatus && onStatus(`Создание сборки «${packName}»…`);
  const inst = createUniqueInstance({ name: packName, mcVersion: mc, loader, icon: '🧱', ramGB: 4 });
  const gameDir = instances.instanceGameDir(inst.id);

  onStatus && onStatus('Распаковка overrides…');
  const ovPrefix = String(manifest.overrides || 'overrides').replace(/\/$/, '') + '/';
  const extracted = extractZipPrefix(zip, ovPrefix, gameDir);
  onProgress && onProgress({ done: extracted, total: extracted, filename: '' });

  // Моды CurseForge: projectID/fileID -> ссылки через публичное зеркало CFWidget.
  const cfFiles = (manifest.files || []).filter(f => f && f.projectID && f.fileID && f.required !== false);
  let okMods = 0, failMods = 0;
  if (cfFiles.length) {
    onStatus && onStatus(`Загрузка модов CurseForge (${cfFiles.length})…`);
    const urls = new Map();
    const ids = cfFiles.map(f => f.fileID);
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const j = await jsonFetch(`https://api.curse.tools/v1/cf-mods/${ids.slice(i, i + 50).join(',')}`);
        for (const it of (j && j.data) || []) if (it && it.downloadUrl) urls.set(String(it.id), it.downloadUrl);
      } catch {}
    }
    const modsDir = path.join(gameDir, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    let done = 0;
    for (const f of cfFiles) {
      const url = urls.get(String(f.fileID));
      if (url) {
        try {
          const fn = decodeURIComponent(path.basename(new URL(url).pathname));
          const dest = safeJoin(modsDir, fn);
          if (dest) { await downloadFile(url, dest, null); okMods++; } else failMods++;
        } catch { failMods++; }
      } else failMods++;
      done++;
      onProgress && onProgress({ done, total: cfFiles.length, filename: 'fileID ' + f.fileID });
    }
  }

  if (loader !== 'vanilla') {
    onStatus && onStatus(`Установка ${loader} ${loaderVersion || ''} (${mc})…`);
    const res = await installLoader(loader, gameDir, mc, s => onStatus && onStatus(s), { version: loaderVersion });
    instances.updateInstance(inst.id, { versionId: res.id, loaderVersion: res.loader });
  }
  const fresh = instances.getInstance(inst.id);
  onStatus && onStatus(`Сборка «${fresh.name}» установлена (${okMods} модов${failMods ? ', ' + failMods + ' не скачались' : ''})`);
  return fresh;
}

/* ================= Единый API ================= */

async function searchModpacks(source, query, gameVersion) {
  if (source === 'ftb') return searchFtbPacks(query);
  return searchModrinthPacks(query, gameVersion);
}

async function installModpack(opts) {
  const common = { versionId: opts.versionId, name: opts.name, onStatus: opts.onStatus, onProgress: opts.onProgress };
  if (opts.source === 'ftb') return installFtbPack({ packId: opts.id, ...common });
  return installModrinthPack({ projectId: opts.id, ...common });
}

module.exports = {
  searchModpacks, installModpack, installModrinthMrpack, importPackZip,
  searchModrinthPacks, modrinthPackVersions,
  searchFtbPacks, ftbPackInfo, ftbVersionManifest,
};
