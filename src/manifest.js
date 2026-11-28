'use strict';
/*
 * Minecraft version manifest + version.json parsing (piston-meta).
 * Supports modern format (1.13+, `arguments`), legacy (`minecraftArguments`)
 * and the 2026 "mainConfig" split-manifest format (client-side merge of
 * version.json + mainConfig.json).
 */

const fs = require('fs');
const META_BASE = 'https://piston-meta.mojang.com';

// Optional disk cache for the version manifest (set from main.js).
let versionCacheFile = null;
let cachedVersions = null;
let cachedVersionsAt = 0;
function setVersionCacheFile(p) { versionCacheFile = p; }
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function fetchJson(url, tries = 2, timeoutMs = 6000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

async function getVersionList() {
  // Serve from memory cache for fast repeat calls (e.g. inheritsFrom lookups).
  if (cachedVersions && Date.now() - cachedVersionsAt < CACHE_TTL) return cachedVersions;
  // Serve from disk cache if fresh — makes startup fast without network.
  if (versionCacheFile && fs.existsSync(versionCacheFile)) {
    try {
      const stat = fs.statSync(versionCacheFile);
      if (Date.now() - stat.mtimeMs < CACHE_TTL) {
        const cached = JSON.parse(fs.readFileSync(versionCacheFile, 'utf8'));
        cachedVersions = cached.versions;
        cachedVersionsAt = Date.now();
        return cachedVersions;
      }
    } catch {}
  }
  const data = await fetchJson(`${META_BASE}/mc/game/version_manifest_v2.json`);
  cachedVersions = data.versions;
  cachedVersionsAt = Date.now();
  if (versionCacheFile) {
    try {
      fs.mkdirSync(require('path').dirname(versionCacheFile), { recursive: true });
      fs.writeFileSync(versionCacheFile, JSON.stringify(data));
    } catch {}
  }
  return cachedVersions; // [{id,type,url,time,releaseTime}]
}

/** Resolve inheritsFrom chains (mods/snapshots pointing at a release). */
async function resolveManifest(url) {
  let m = await fetchJson(url);
  let guard = 0;
  while (m.inheritsFrom && guard++ < 5) {
    const list = await getVersionList();
    const parent = list.find(v => v.id === m.inheritsFrom);
    if (!parent) throw new Error(`inheritsFrom not found: ${m.inheritsFrom}`);
    const pm = await resolveManifest(parent.url);
    m = {
      ...pm,
      ...m,
      libraries: [...(pm.libraries || []), ...(m.libraries || [])],
      arguments: mergeArgs(pm.arguments, m.arguments),
    };
  }
  return m;
}

function mergeArgs(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (Array.isArray(a) || Array.isArray(b)) {
    return [].concat(a, b);
  }
  return {
    game: [].concat(a.game || [], b.game || []),
    jvm: [].concat(a.jvm || [], b.jvm || []),
  };
}

/**
 * Build a normalized spec from a resolved manifest.
 * If manifest.mainConfig exists (new 2026 format), fetch and merge it.
 * `features` controls demo/custom-resolution/quick-play args (see allowByRules).
 */
async function buildSpec(manifestUrl, features) {
  const m = await resolveManifest(manifestUrl);
  return normalizeSpec(m, features);
}

/**
 * Build a spec from a locally installed version.json (e.g. Fabric/Forge
 * installed into .minecraft/versions/<id>/<id>.json). The file may inherit
 * from a vanilla version, which is resolved via piston-meta.
 */
async function buildSpecFromFile(jsonPath, features) {
  const local = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (local.inheritsFrom) {
    const list = await getVersionList();
    const parent = list.find(v => v.id === local.inheritsFrom);
    if (!parent) throw new Error(`Родительская версия не найдена: ${local.inheritsFrom}`);
    const pm = await resolveManifest(parent.url);
    return normalizeSpec(mergeInherit(pm, local), features);
  }
  return normalizeSpec(local, features);
}

function mergeInherit(parent, child) {
  return {
    ...parent,
    ...child,
    libraries: [...(parent.libraries || []), ...(child.libraries || [])],
    arguments: mergeArgs(parent.arguments, child.arguments),
  };
}

/**
 * Дедупликация библиотек по ключу group:artifact[:classifier].
 *
 * Наследование манифестов (inheritsFrom / mainConfig) приносит одну и ту же
 * библиотеку в разных версиях: например org.ow2.asm:asm 9.6 из ванильного
 * 1.21.4 и 9.10.1 из Fabric Loader. После простой конкатенации обе попадали
 * в classpath, и Fabric Loader падал с
 * "duplicate ASM classes found on classpath" (LoaderUtil.verifyClasspath).
 *
 * Оставляем ОДНУ запись с максимальной версией (сравнение покомпонентное,
 * число-осознанное: 9.10.1 > 9.6). При равных версиях предпочитаем запись с
 * downloads.artifact (там есть sha1/size с piston-meta), иначе — последнюю
 * (дочерний манифест перекрывает родительский).
 *
 * Classifiers (например, asm:asm:9.6 vs asm:asm:9.6:natives) — это разные
 * артефакты: ключ включает classifier, между собой они не дедуплицируются.
 */
function libKey(name) {
  const base = String(name).split('@')[0];
  const parts = base.split(':');
  const key = parts.slice(0, 2).join(':');
  return parts.length > 3 ? `${key}:${parts[3]}` : key;
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.\-_+]/), pb = String(b).split(/[.\-_+]/);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || '0', y = pb[i] || '0';
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d) return d;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function dedupeLibraries(libs) {
  const byKey = new Map();
  const out = [];
  for (const lib of libs || []) {
    if (!lib || !lib.name) continue;
    const key = libKey(lib.name);
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, lib); out.push(lib); continue; }
    const cmp = compareVersions(String(lib.name).split(':')[2], String(prev.name).split(':')[2]);
    if (cmp > 0 || (cmp === 0 && !prev.downloads && !!lib.downloads)) {
      byKey.set(key, lib);
      out[out.indexOf(prev)] = lib;
    }
  }
  return out;
}

async function normalizeSpec(m, features) {
  if (m.mainConfig && typeof m.mainConfig === 'object' && m.mainConfig.url) {
    const cfg = await fetchJson(m.mainConfig.url);
    m = deepMerge(cfg, m); // manifest fields win, config supplies libraries/args/downloads
  }

  const osName = platformName();
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86';

  // Дедупликация ПОСЛЕ всех слияний (inheritsFrom + mainConfig) — единый узел.
  const libraries = dedupeLibraries(m.libraries || [])
    .filter(lib => allowByRules(lib.rules, osName, arch, features))
    .map(lib => parseLibrary(lib, osName, arch))
    .filter(Boolean);

  const clientJar = m.downloads && m.downloads.client;
  if (!clientJar) throw new Error('В версии нет client.jar (нужен клиентский манифест)');

  let assetIndexUrl = null, assetIndexId = null;
  if (m.assetIndex && m.assetIndex.url) { assetIndexUrl = m.assetIndex.url; assetIndexId = m.assetIndex.id; }

  const logging = (m.logging && m.logging.client && m.logging.client.file &&
                    m.logging.client.file.url) ? m.logging.client.file.url : null;

  let argsGame, argsJvm;
  if (m.arguments && !Array.isArray(m.arguments) && (m.arguments.game || m.arguments.jvm)) {
    argsGame = flatSelect(m.arguments.game, osName, arch, features);
    argsJvm = flatSelect(m.arguments.jvm, osName, arch, features);
  } else if (Array.isArray(m.arguments)) {
    argsGame = flatSelect(m.arguments, osName, arch, features);
    argsJvm = defaultJvmArgs();
  } else if (m.minecraftArguments) {
    argsGame = m.minecraftArguments.split(/\s+/);
    argsJvm = defaultJvmArgs();
  } else {
    argsGame = [];
    argsJvm = defaultJvmArgs();
  }

  return {
    id: m.id,
    type: m.type || 'release',
    mainClass: m.mainClass,
    minecraftVersion: m.minecraftVersion || m.inheritsFrom || m.id,
    javaMajor: (m.javaVersion && m.javaVersion.majorVersion) || 17,
    javaComponent: m.javaVersion && m.javaVersion.component,
    libraries,
    client: { url: clientJar.url, sha1: clientJar.sha1, size: clientJar.size || 0 },
    assetIndex: assetIndexUrl ? { url: assetIndexUrl, id: assetIndexId } : null,
    assets: m.assets || assetIndexId || 'legacy',
    logging,
    argsGame,
    argsJvm,
    complianceLevel: m.complianceLevel || 1,
  };
}

function defaultJvmArgs() {
  return ['-Djava.library.path=${natives_directory}',
          '-cp', '${classpath}'];
}

function deepMerge(base, over) {
  if (Array.isArray(base) && Array.isArray(over)) return [...base, ...over];
  if (isObj(base) && isObj(over)) {
    const out = { ...base };
    for (const k of Object.keys(over)) {
      out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
    }
    return out;
  }
  return over !== undefined ? over : base;
}
function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }

function platformName() {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'osx';
    default: return 'linux';
  }
}

function allowByRules(rules, osName, arch, features) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    const osMatch = rule.os ? ruleMatch(rule.os, osName, arch) : true;
    const featMatch = !rule.features
      ? true
      : Object.entries(rule.features).every(([k, v]) => !!((features || {})[k]) === !!v);
    const match = osMatch && featMatch;
    if (rule.action === 'allow') { if (match) allowed = true; }
    else if (rule.action === 'disallow') { if (match) return false; }
  }
  return allowed;
}

function ruleMatch(os, osName, arch) {
  if (os.name && os.name !== osName) return false;
  if (os.arch) {
    const want = os.arch === 'x86' ? 'x86' : os.arch;
    if (want !== arch) return false;
  }
  return true;
}

/** Expand conditional argument arrays into a flat list for this OS. */
function flatSelect(arr, osName, arch, features) {
  const out = [];
  for (const item of arr || []) {
    if (typeof item === 'string') { out.push(item); continue; }
    if (isObj(item) && item.rules) {
      if (allowByRules(item.rules, osName, arch, features)) {
        const vals = item.value !== undefined ? item.value : item.values;
        if (typeof vals === 'string') out.push(vals);
        else if (Array.isArray(vals)) out.push(...vals.filter(v => typeof v === 'string'));
      }
    }
  }
  return out;
}

function coordToPath(name) {
  const [g, a, rest] = name.split(':');
  let v = rest, classifier = null;
  const idx = rest.lastIndexOf('@');
  if (idx > -1) { classifier = rest.slice(idx + 1); v = rest.slice(0, idx); }
  const file = `${a}-${v}${classifier ? '-' + classifier : ''}.jar`;
  return `${g.replace(/\./g, '/')}/${a}/${v}/${file}`;
}

function parseLibrary(lib, osName, arch) {
  const entry = { name: lib.name, download: null, native: false };

  if (lib.downloads) {
    const d = lib.downloads.artifact;
    if (d && d.url) entry.download = { url: d.url, path: d.path || coordToPath(lib.name), sha1: d.sha1, size: d.size || 0 };
    const natives = lib.natives || {};
    const key = natives[osName];
    if (key && lib.downloads.classifiers) {
      let clsKey = key.replace('${arch}', arch === 'arm64' ? 'arm64' : '32');
      const nd = lib.downloads.classifiers[clsKey];
      if (nd && nd.url) {
        entry.native = true;
        entry.download = { url: nd.url, path: nd.path || coordToPath(`${lib.name}@${clsKey}`), sha1: nd.sha1, size: nd.size || 0 };
      }
    }
  } else if (lib.url) {
    const pathStr = coordToPath(lib.name);
    entry.download = { url: lib.url.replace(/\/*$/, '/') + pathStr, path: pathStr, sha1: null, size: 0 };
  }

  if (!entry.download) return null;
  return entry;
}

module.exports = { fetchJson, getVersionList, resolveManifest, buildSpec, buildSpecFromFile, coordToPath, platformName, setVersionCacheFile, dedupeLibraries, compareVersions, libKey };
