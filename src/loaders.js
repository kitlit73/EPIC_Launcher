'use strict';
/*
 * Fabric / Forge installation (programmatic, no separate GUI installer).
 *
 * Fabric: we fetch the official Fabric meta profile JSON (which is a full
 * version.json with inheritsFrom=<mc>) and write it into
 * .minecraft/versions/<id>/<id>.json — the normal downloader then fetches all
 * libraries on first launch.
 *
 * Forge: we download the official installer jar, read the embedded version.json
 * (a full manifest with inheritsFrom=<mc> and all Forge libraries), write it to
 * .minecraft/versions/<id>/<id>.json and copy the embedded
 * maven/.../forge-<ver>-universal.jar into .minecraft/libraries so the
 * classpath resolves.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { smartFetch } = require('./net');

const UA = 'epic-launcher/2.0.0 (https://github.com/)';

const FABRIC_LOADER_META = 'https://meta.fabricmc.net/v2/versions/loader';
const QUILT_LOADER_META = 'https://meta.quiltmc.org/v3/versions/loader';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases';

// Кэш версий загрузчиков в памяти — повторный запуск не ходит в сеть.
const fabricMetaCache = new Map();   // gameVersion -> loader version
let forgePromosCache = null;        // raw promos JSON

async function fetchJson(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await smartFetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

async function fetchText(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await smartFetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      // ВАЖНО: читаем поток, а не res.arrayBuffer() — буферизация всего тела
      // падает на некоторых CDN (maven.neoforged.net) с "fetch failed".
      const chunks = [];
      for await (const c of res.body) chunks.push(c);
      return Buffer.concat(chunks);
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1200 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/* ---------------- Fabric ---------------- */

async function fabricLoaderVersion(gameVersion) {
  if (fabricMetaCache.has(gameVersion)) return fabricMetaCache.get(gameVersion);
  const loaders = await fetchJson(`${FABRIC_LOADER_META}/${encodeURIComponent(gameVersion)}`);
  if (!loaders || !loaders.length) {
    throw new Error(`Fabric не поддерживает Minecraft ${gameVersion}. Поддерживаются релизы 1.14+.`);
  }
  // Meta API отдаёт сборки от новых к старым; предпочитаем последнюю стабильную,
  // иначе берём самую новую (обычно loaders[0]).
  const stable = loaders.find(l => l.loader && l.loader.stable) || loaders[0];
  const ver = stable.loader.version;
  fabricMetaCache.set(gameVersion, ver);
  return ver;
}

async function fabricProfile(gameVersion, loader) {
  const profile = await fetchJson(
    `${FABRIC_LOADER_META}/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loader)}/profile/json`);
  return profile;
}

/* ---------------- Forge ---------------- */

async function resolveForgeVersion(gameVersion) {
  if (!forgePromosCache) {
    const promos = await fetchJson(FORGE_PROMOS);
    forgePromosCache = promos.promos || {};
  }
  const p = forgePromosCache;
  // prefer recommended, fall back to latest
  const recommended = p[`${gameVersion}-recommended`];
  const latest = p[`${gameVersion}-latest`];
  const build = recommended || latest;
  if (!build) throw new Error(`Forge не поддерживает Minecraft ${gameVersion}`);
  return { build, recommended: !!recommended, forgeVersion: `${gameVersion}-${build}` };
}

async function downloadForgeInstaller(forgeVersion) {
  const url = `${FORGE_MAVEN}/${forgeVersion}/forge-${forgeVersion}-installer.jar`;
  const buf = await fetchText(url);
  return new AdmZip(buf);
}

/* ---------------- Install (writes into .minecraft) ---------------- */

/**
 * Применить скачанный установщик (Forge/NeoForge): манифест -> versions/<id>/,
 * встроенные maven/-джарники -> libraries/. Старые установщики (1.7.10 и ранее)
 * хранят манифест в install_profile.json (versionInfo) — поддерживаем оба формата.
 * Возвращает распарсенный манифест.
 */
function applyInstallerZip(zip, gameDir, id) {
  const vdir = path.join(gameDir, 'versions', id);
  const vfile = path.join(vdir, `${id}.json`);

  const vjson = zip.getEntry('version.json');
  let manifest;
  if (vjson) {
    manifest = JSON.parse(vjson.getData().toString('utf8'));
  } else {
    const profEntry = zip.getEntry('install_profile.json');
    if (!profEntry) throw new Error('В установщике нет version.json/install_profile.json');
    const prof = JSON.parse(profEntry.getData().toString('utf8'));
    manifest = prof.versionInfo;
    if (!manifest) throw new Error('В install_profile.json нет versionInfo');
    // Встроенный universal-jar копируем в libraries (старые версии не лежат в maven/)
    if (prof.install && prof.install.filePath) {
      const coord = prof.install.path; // "net.minecraftforge:forge:1.7.10-..."
      const embedded = zip.getEntry(prof.install.filePath);
      if (embedded && coord) {
        const { coordToPath } = require('./manifest');
        const libPath = coord.endsWith('-universal') ? coordToPath(coord) : coordToPath(`${coord}-universal`);
        const dest = path.join(gameDir, 'libraries', libPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) fs.writeFileSync(dest, embedded.getData());
      }
    }
  }
  // Приводим id манифеста к нашему (файл пишется под этим именем)
  manifest.id = id;

  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(vfile, JSON.stringify(manifest, null, 2));

  // Копируем встроенные maven-джарники (universal + fmlcore + languages и т.д.)
  // в .minecraft/libraries, чтобы classpath собрался без отдельных загрузок.
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith('maven/') || entry.isDirectory) continue;
    const rel = entry.entryName.replace(/^maven\//, '');
    const dest = path.join(gameDir, 'libraries', rel);
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
  }
  return manifest;
}

// Быстрая проверка: уже установленный загрузчик для версии (без сети).
function findInstalledLoader(gameDir, kind, gameVersion) {
  const vdir = path.join(gameDir, 'versions');
  if (!fs.existsSync(vdir)) return null;
  let dirs = [];
  try { dirs = fs.readdirSync(vdir); } catch { return null; }
  const esc = gameVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (kind === 'fabric') {
    const re = new RegExp(`^fabric-loader-[\\d.]+-${esc}$`, 'i');
    return dirs.find(d => re.test(d)) || null;
  }
  if (kind === 'forge') {
    const re = new RegExp(`^${esc}-forge-[\\w.\\-]+$`, 'i');
    return dirs.find(d => re.test(d)) || null;
  }
  if (kind === 'neoforge') {
    const re = new RegExp(`^${esc}-neoforge-[\\w.\\-]+$`, 'i');
    return dirs.find(d => re.test(d)) || null;
  }
  if (kind === 'quilt') {
    const re = new RegExp(`^quilt-loader-[\\w.\\-]+-${esc}$`, 'i');
    return dirs.find(d => re.test(d)) || null;
  }
  return null;
}

// loaderVersion — необязательная ТОЧНАЯ версия (из метаданных сборок Modrinth/FTB).
async function installFabric(gameDir, gameVersion, onStatus, loaderVersion) {
  const existing = findInstalledLoader(gameDir, 'fabric', gameVersion);
  if (existing && fs.existsSync(path.join(gameDir, 'versions', existing, `${existing}.json`))) {
    onStatus && onStatus(`Fabric уже установлен (${gameVersion})`);
    const loader = existing.match(/^fabric-loader-([\d.]+)-/i)?.[1] || '';
    return { id: existing, loader, type: 'fabric', cached: true };
  }
  const loader = loaderVersion || await fabricLoaderVersion(gameVersion);
  const id = `fabric-loader-${loader}-${gameVersion}`;
  const vdir = path.join(gameDir, 'versions', id);
  const vfile = path.join(vdir, `${id}.json`);
  const profile = await fabricProfile(gameVersion, loader);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(vfile, JSON.stringify(profile, null, 2));
  onStatus && onStatus(`Fabric ${loader} установлен (${gameVersion})`);
  return { id, loader, type: 'fabric' };
}

// forgeBuild — необязательная точная сборка Forge (например "47.3.0") для сборок.
async function installForge(gameDir, gameVersion, onStatus, forgeBuild) {
  const existing = findInstalledLoader(gameDir, 'forge', gameVersion);
  if (existing && fs.existsSync(path.join(gameDir, 'versions', existing, `${existing}.json`))) {
    onStatus && onStatus(`Forge уже установлен (${gameVersion})`);
    const build = existing.match(/-forge-([\w.\-]+)$/i)?.[1] || '';
    return { id: existing, loader: build, type: 'forge', forgeVersion: `${gameVersion}-${build}`, cached: true };
  }
  let build, forgeVersion;
  if (forgeBuild) {
    build = forgeBuild;
    forgeVersion = `${gameVersion}-${forgeBuild}`;
  } else {
    ({ build, forgeVersion } = await resolveForgeVersion(gameVersion));
  }
  onStatus && onStatus(`Скачивание Forge ${forgeVersion} (installer)…`);
  let zip = null;
  try {
    zip = await downloadForgeInstaller(forgeVersion);
  } catch (e) {
    // Точную сборку мог удалить Forge из своего maven (старые версии, ≤1.10).
    // Фоллбэк: recommended/latest из promos — если это не она же.
    if (!forgeBuild) throw e;
    const fb = await resolveForgeVersion(gameVersion);
    if (fb.build === build) throw e;
    onStatus && onStatus(`Forge ${build} недоступен — берём ${fb.build}`);
    build = fb.build;
    forgeVersion = fb.forgeVersion;
    zip = await downloadForgeInstaller(forgeVersion);
  }

  // id установленной версии совпадает с manifest.id установщика
  // (например "1.20.1-forge-47.4.28"), а не "forge-1.20.1-47.4.28".
  const id = `${gameVersion}-forge-${build}`;
  applyInstallerZip(zip, gameDir, id);

  onStatus && onStatus(`Forge ${build} установлен (${gameVersion})`);
  return { id, loader: build, type: 'forge', forgeVersion };
}

/* ---------------- NeoForge ----------------
 * Установщик NeoForge лежит на maven.neoforged.net:
 *   MC 1.20.1 (эпоха 47.1.x): net/neoforged/forge/<mc>-<build>/forge-<mc>-<build>-installer.jar
 *   MC 1.20.2+ (20.x/21.x/26.x): net/neoforged/neoforge/<build>/neoforge-<build>-installer.jar
 * Нумерация NeoForge привязана к MC: 20.4.237 -> 1.20.4, 21.1.267 -> 1.21.1,
 * 26.2.0.95 -> 26.2. Внутри — тот же формат, что у Forge: version.json + maven/.
 */

/** Последняя сборка NeoForge для версии MC (maven-metadata.xml). */
async function resolveNeoforgeVersion(gameVersion) {
  let xml, prefix;
  if (gameVersion === '1.20.1') {
    // Эпоха 1.20.1: артефакты в net/neoforged/forge/<mc>-<build>.
    xml = (await fetchText(`${NEOFORGE_MAVEN}/net/neoforged/forge/maven-metadata.xml`)).toString('utf8');
    prefix = '1.20.1-';
  } else {
    xml = (await fetchText(`${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`)).toString('utf8');
    prefix = gameVersion.replace(/^1\./, '') + '.'; // 1.21.1 -> "21.1.", 26.2 -> "26.2."
  }
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
  const candidates = all.filter(v => v.startsWith(prefix));
  if (!candidates.length) throw new Error(`NeoForge не найден для Minecraft ${gameVersion}`);
  // maven-metadata отсортирован по возрастанию — последний и есть новейший.
  const latest = candidates[candidates.length - 1];
  return latest.slice(prefix.length);
}

async function installNeoforge(gameDir, gameVersion, onStatus, neoBuild) {
  const existing = findInstalledLoader(gameDir, 'neoforge', gameVersion);
  if (existing && fs.existsSync(path.join(gameDir, 'versions', existing, `${existing}.json`))) {
    onStatus && onStatus(`NeoForge уже установлен (${gameVersion})`);
    const build = existing.match(/-neoforge-([\w.\-]+)$/i)?.[1] || '';
    return { id: existing, loader: build, type: 'neoforge', cached: true };
  }
  // Без точной версии (создание сборки) — берём последнюю подходящую.
  const build = neoBuild || await resolveNeoforgeVersion(gameVersion);
  const id = `${gameVersion}-neoforge-${build}`;
  onStatus && onStatus(`Скачивание NeoForge ${build} (installer)…`);
  // Эпоха 1.20.1 (47.1.x) лежит в net/neoforged/forge/<mc>-<build>, остальное —
  // в net/neoforged/neoforge/<build>.
  const urls = [];
  if (/^47\./.test(build)) {
    urls.push(`${NEOFORGE_MAVEN}/net/neoforged/forge/${gameVersion}-${build}/forge-${gameVersion}-${build}-installer.jar`);
  }
  urls.push(`${NEOFORGE_MAVEN}/net/neoforged/neoforge/${build}/neoforge-${build}-installer.jar`);
  let zip = null, lastErr = null;
  for (const u of urls) {
    try {
      zip = new AdmZip(await fetchText(u)); // fetchText: ретраи + стрим
      break;
    } catch (e) {
      lastErr = e;
      // 404 = пути нет, пробуем следующий без повторов
      if (/HTTP 404/.test(e.message)) { lastErr = e; }
    }
  }
  if (!zip) throw new Error(`Не удалось скачать NeoForge ${build}: ${lastErr && lastErr.message}`);
  applyInstallerZip(zip, gameDir, id);
  onStatus && onStatus(`NeoForge ${build} установлен (${gameVersion})`);
  return { id, loader: build, type: 'neoforge' };
}

/* ---------------- Quilt ---------------- */

async function quiltLoaderVersion(gameVersion) {
  const loaders = await fetchJson(`${QUILT_LOADER_META}/${encodeURIComponent(gameVersion)}`);
  if (!loaders || !loaders.length) throw new Error(`Quilt не поддерживает Minecraft ${gameVersion}`);
  const stable = loaders.find(l => l.loader && l.loader.stable) || loaders[0];
  return stable.loader.version;
}

async function installQuilt(gameDir, gameVersion, onStatus, loaderVersion) {
  const existing = findInstalledLoader(gameDir, 'quilt', gameVersion);
  if (existing && fs.existsSync(path.join(gameDir, 'versions', existing, `${existing}.json`))) {
    onStatus && onStatus(`Quilt уже установлен (${gameVersion})`);
    const loader = existing.match(/^quilt-loader-([\w.\-]+)-/i)?.[1] || '';
    return { id: existing, loader, type: 'quilt', cached: true };
  }
  const loader = loaderVersion || await quiltLoaderVersion(gameVersion);
  const id = `quilt-loader-${loader}-${gameVersion}`;
  const vdir = path.join(gameDir, 'versions', id);
  const vfile = path.join(vdir, `${id}.json`);
  const profile = await fetchJson(
    `${QUILT_LOADER_META}/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loader)}/profile/json`);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(vfile, JSON.stringify(profile, null, 2));
  onStatus && onStatus(`Quilt ${loader} установлен (${gameVersion})`);
  return { id: profile.id || id, loader, type: 'quilt' };
}

async function installLoader(kind, gameDir, gameVersion, onStatus, opts = {}) {
  const v = opts.version || null;
  if (kind === 'fabric') return installFabric(gameDir, gameVersion, onStatus, v);
  if (kind === 'forge') return installForge(gameDir, gameVersion, onStatus, v);
  if (kind === 'neoforge') return installNeoforge(gameDir, gameVersion, onStatus, v);
  if (kind === 'quilt') return installQuilt(gameDir, gameVersion, onStatus, v);
  throw new Error('Неизвестный загрузчик: ' + kind);
}

module.exports = { installLoader, resolveForgeVersion };
