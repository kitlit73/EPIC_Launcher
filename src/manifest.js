'use strict';
/*
 * Minecraft version manifest + version.json parsing (piston-meta).
 * Supports modern format (1.13+, `arguments`), legacy (`minecraftArguments`)
 * and the 2026 "mainConfig" split-manifest format (client-side merge of
 * version.json + mainConfig.json).
 */

const META_BASE = 'https://piston-meta.mojang.com';

async function fetchJson(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

async function getVersionList() {
  const data = await fetchJson(`${META_BASE}/mc/game/version_manifest_v2.json`);
  return data.versions; // [{id,type,url,time,releaseTime}]
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
 */
async function buildSpec(manifestUrl) {
  let m = await resolveManifest(manifestUrl);

  if (m.mainConfig && typeof m.mainConfig === 'object' && m.mainConfig.url) {
    const cfg = await fetchJson(m.mainConfig.url);
    m = deepMerge(cfg, m); // manifest fields win, config supplies libraries/args/downloads
  }

  const osName = platformName();
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86';

  const libraries = (m.libraries || [])
    .filter(lib => allowByRules(lib.rules, osName, arch))
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
    argsGame = flatSelect(m.arguments.game, osName, arch);
    argsJvm = flatSelect(m.arguments.jvm, osName, arch);
  } else if (Array.isArray(m.arguments)) {
    argsGame = flatSelect(m.arguments, osName, arch);
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

function allowByRules(rules, osName, arch) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    const match = rule.os ? ruleMatch(rule.os, osName, arch) : true;
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
function flatSelect(arr, osName, arch) {
  const out = [];
  for (const item of arr || []) {
    if (typeof item === 'string') { out.push(item); continue; }
    if (isObj(item) && item.rules) {
      if (allowByRules(item.rules, osName, arch)) {
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

module.exports = { fetchJson, getVersionList, resolveManifest, buildSpec, coordToPath, platformName };
