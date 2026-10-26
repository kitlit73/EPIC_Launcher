'use strict';
/*
 * Java runtime resolution: Mojang official runtimes (with real extraction of
 * tar.gz / zip archives) + system java fallback.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { fetchJson } = require('./manifest');

const RUNTIME_INDEX_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
let indexCache = null;

function mojangOs() {
  switch (process.platform) {
    case 'win32': return 'windows-x64';
    case 'darwin': return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
    default: return process.arch === 'arm64' ? 'linux-i386' : 'linux';
  }
}

async function getRuntimeIndex() {
  if (!indexCache) indexCache = await fetchJson(RUNTIME_INDEX_URL);
  return indexCache;
}

/** Download + extract an official Mojang JRE into runtimes/<component>. Returns java bin path or null. */
async function installMojangRuntime(component, runtimeDir, onProgress) {
  try {
    const idx = await getRuntimeIndex();
    const osKey = mojangOs();
    const list = idx[osKey] && idx[osKey][component];
    if (!list || !list.length) return null;
    const latest = list[0].manifest;
    const entries = await fetchJson(latest.url);

    const target = path.join(runtimeDir, component);
    const javaBin = path.join(target, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(javaBin)) return javaBin;

    fs.mkdirSync(target, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jre-'));

    let done = 0;
    for (const e of entries) {
      if (!e.url || e.type !== 'file') continue;
      const res = await fetch(e.url);
      if (!res.ok) throw new Error(`JRE HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const local = path.join(tmp, path.basename(e.path));
      fs.writeFileSync(local, buf);
      done++;
      if (onProgress) onProgress(done, entries.length, e.path);
    }

    const archive = entries.find(e => e.type === 'file' && /\.(tar\.gz|tgz|zip)$/i.test(e.path || ''));
    if (!archive) throw new Error('Не найден архив JRE в манифесте');
    const arcPath = path.join(tmp, path.basename(archive.path));

    await extractRuntimeArchive(arcPath, target);

    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    try { fs.chmodSync(javaBin, 0o755); } catch {}

    return fs.existsSync(javaBin) ? javaBin : null;
  } catch (e) {
    console.error('[java] mojang runtime failed:', e.message);
    return null;
  }
}

async function extractRuntimeArchive(arcPath, target) {
  if (/\.zip$/i.test(arcPath)) {
    const zip = new AdmZip(arcPath);
    zip.extractAllTo(target, true);
    return;
  }
  // tar.gz — use system tar (present on Linux/macOS; bsdtar/Git-Bash on Windows)
  execFileSync('tar', ['-xzf', arcPath, '-C', target], { stdio: 'ignore' });
}

/** All distinct java executables found on the system (deduped, verified). */
function collectJavaCandidates() {
  const candidates = [];
  const push = p => { if (p) candidates.push(p); };
  if (process.env.JAVA_HOME) push(path.join(process.env.JAVA_HOME, 'bin', exe()));
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['-a', 'java'], { encoding: 'utf8' });
    for (const line of out.split('\n')) push(line.trim());
  } catch { push(which('java')); }
  const dirs = [
    '/usr/lib/jvm', path.join(os.homedir() || '', '.sdkman/candidates/java'),
    '/Library/Java/JavaVirtualMachines',
    'C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft\\jdk-17.0.13.11-hotspot', 'C:\\Program Files\\Zulu',
    'C:\\Program Files\\BellSoft', 'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files (x86)\\Java',
  ];
  for (const dir of dirs) {
    try {
      for (const d of fs.readdirSync(dir)) {
        push(path.join(dir, d, 'bin', exe()));
        push(path.join(dir, d, 'Contents', 'Home', 'bin', exe()));
      }
    } catch {}
  }
  // Windows registry (JavaSoft\JDK and older JavaSoft\Java Runtime Environment)
  if (process.platform === 'win32') {
    for (const key of ['HKLM\\SOFTWARE\\JavaSoft\\JDK', 'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JDK']) {
      try {
        const out = execFileSync('reg', ['query', key], { encoding: 'utf16le' });
        for (const m of out.matchAll(/InstallPath\s+REG_SZ\s+(.+?)\s*$/gm)) {
          push(path.join(m[1].trim(), 'bin', exe()));
        }
      } catch {}
    }
  }
  const seen = new Set();
  const uniq = [];
  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue;
    let real = c; try { real = fs.realpathSync(c); } catch {}
    if (seen.has(real)) continue;
    seen.add(real);
    uniq.push(c);
  }
  return uniq;
}

/**
 * List installed JREs/JDKs with version info — for the UI dropdown.
 * runtimeDir: where launcher-downloaded Mojang runtimes live (also listed).
 */
function listInstalledJava(runtimeDir) {
  const items = [];
  const add = (p, source) => {
    const v = javaMajorVersion(p);
    if (v == null) return;
    let vendor = 'Java';
    try {
      const out = require('child_process').spawnSync(p, ['-version'], { encoding: 'utf8' }).stderr || '';
      const vm = /"(.*?)"/.exec(out) || /(OpenJDK[^"\r\n]*)/.exec(out);
      if (vm) vendor = vm[1];
    } catch {}
    items.push({ path: p, major: v, vendor, source });
  };
  for (const p of collectJavaCandidates()) add(p, 'system');
  try {
    for (const d of fs.readdirSync(runtimeDir)) {
      const bin = path.join(runtimeDir, d, 'bin', exe());
      if (fs.existsSync(bin)) add(bin, 'mojang-runtime');
    }
  } catch {}
  items.sort((a, b) => a.major - b.major || String(a.path).localeCompare(String(b.path)));
  return items;
}

/** Find a system java of given major version (or any). */
function findSystemJava(major) {
  const candidates = collectJavaCandidates();
  for (const c of candidates) {
    const v = javaMajorVersion(c);
    if (v == null) continue;
    if (major == null || v >= major) return c;
  }
  return null;
}

function which(bin) {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
    return out.split('\n')[0].trim() || null;
  } catch { return null; }
}

function exe() { return process.platform === 'win32' ? 'java.exe' : 'java'; }

const majorCache = new Map();
function javaMajorVersion(javaPath) {
  if (majorCache.has(javaPath)) return majorCache.get(javaPath);
  try {
    const out = require('child_process').spawnSync(javaPath, ['-version'], { encoding: 'utf8' }).stderr || '';
    const m = /version "?(\d+)(?:\.(\d+))?/.exec(out);
    let v = m ? parseInt(m[1], 10) : null;
    if (v === 1 && m[2]) v = parseInt(m[2], 10); // 1.8 -> 8
    majorCache.set(javaPath, v);
    return v;
  } catch {
    return null;
  }
}

/**
 * Resolve a java executable that satisfies required major version.
 * Strategy: manual user choice → cached Mojang runtime → system java
 * (minimal sufficient major, not the newest) → download Mojang runtime → any java.
 */
async function resolveJava(spec, runtimeDir, onProgress, manualPath) {
  const need = spec.javaMajor || 17;
  const comp = spec.javaComponent;

  // 1. explicit user selection from the dropdown
  if (manualPath && fs.existsSync(manualPath)) {
    return { path: manualPath, source: 'manual', major: javaMajorVersion(manualPath) };
  }

  // 2. previously downloaded Mojang runtime
  if (comp) {
    const p = path.join(runtimeDir, comp, 'bin', exe());
    if (fs.existsSync(p)) return { path: p, source: 'mojang' };
  }

  // 3. pick the *smallest* installed JDK that is >= need (e.g. Java 8 for 1.16.5),
  //    instead of blindly taking the first/newest one.
  const suitable = collectJavaCandidates()
    .map(p => ({ p, v: javaMajorVersion(p) }))
    .filter(x => x.v != null && x.v >= need)
    .sort((a, b) => a.v - b.v);
  if (suitable.length) return { path: suitable[0].p, source: 'system' };

  // 4. download official Mojang runtime
  if (comp) {
    const order = [comp, 'java-runtime-gamma', 'java-runtime-beta', 'java-runtime-delta', 'java-runtime-epsilon']
      .filter((v, i, a) => a.indexOf(v) === i);
    for (const c of order) {
      const p = await installMojangRuntime(c, runtimeDir, onProgress);
      if (p && (javaMajorVersion(p) || 0) >= need) return { path: p, source: 'mojang' };
    }
  }

  const any = findSystemJava(null);
  if (any) return { path: any, source: 'system-old' };

  throw new Error(`Java ${need}+ не найдена и не скачалась. Установите JRE или проверьте интернет.`);
}

module.exports = { resolveJava, installMojangRuntime, findSystemJava, listInstalledJava, javaMajorVersion };
