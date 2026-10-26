'use strict';
/*
 * Download manager: parallel fetch with progress events, resume-safe caching
 * by sha1, asset objects + virtual assets, native extraction (jar/zip).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { fetchJson } = require('./manifest');

const CONCURRENCY = 8;

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(p);
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function downloadOne(url, dest, expectedSha, onBytes) {
  ensureDir(path.dirname(dest));
  const tmp = dest + '.part';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const ws = fs.createWriteStream(tmp);
  try {
    for await (const chunk of res.body) {
      ws.write(chunk);
      if (onBytes) onBytes(chunk.length);
    }
  } finally {
    ws.end();
    await new Promise(r => ws.on('close', r));
  }
  if (expectedSha) {
    const got = await sha1File(tmp);
    if (got !== expectedSha) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`SHA1 не совпал (${path.basename(dest)})`);
    }
  }
  fs.renameSync(tmp, dest);
}

/** Simple async pool. */
async function pool(items, worker, concurrency = CONCURRENCY) {
  let i = 0;
  const errors = [];
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx], idx); }
      catch (e) { errors.push(e); }
    }
  }
  const runners = [];
  for (let k = 0; k < Math.min(concurrency, items.length); k++) runners.push(run());
  await Promise.all(runners);
  if (errors.length) throw errors[0];
}

class Downloader {
  constructor(gameDir, emit) {
    this.dir = gameDir; // .minecraft
    this.emit = emit || (() => {});
  }

  /** Download a queue of {url, sha1, size, path(rel)} into baseDir. */
  async fetchAll(tasks, baseDir, stageLabel) {
    const todo = tasks.filter(t => {
      const p = path.join(baseDir, t.path);
      return !(t.sha1 && fs.existsSync(p)); // re-check sha lazily only when missing
    });
    const totalBytes = todo.reduce((s, t) => s + (t.size || 0), 0) || 1;
    let doneBytes = 0, doneFiles = 0;
    const started = Date.now();
    const timer = setInterval(() => {
      const secs = (Date.now() - started) / 1000;
      this.emit({
        stage: stageLabel,
        percent: Math.min(99, Math.round(doneBytes / totalBytes * 100)),
        speed: `${(doneBytes / (secs || 1) / 1048576).toFixed(1)} МБ/с`,
        filesDone: doneFiles, filesTotal: todo.length,
      });
    }, 300);

    try {
      await pool(todo, async t => {
        await downloadOne(t.url, path.join(baseDir, t.path), t.sha1, b => { doneBytes += b; });
        doneFiles++;
      });
    } finally {
      clearInterval(timer);
    }
    this.emit({ stage: stageLabel, percent: 100, speed: '0 МБ/с', filesDone: todo.length, filesTotal: todo.length });
    return todo.length;
  }

  /** spec -> everything needed on disk. Returns paths for launch. */
  async install(spec, onStage) {
    const vdir = ensureDir(path.join(this.dir, 'versions', spec.id));
    const libsDir = ensureDir(path.join(this.dir, 'libraries'));
    const nativesDir = ensureDir(path.join(vdir, `natives-${process.platform}`));
    const assetsDir = ensureDir(path.join(this.dir, 'assets'));

    // 1. version jar
    const clientJar = path.join(vdir, `${spec.id}.jar`);
    if (!fs.existsSync(clientJar)) {
      onStage('Загрузка ядра игры…');
      await downloadOne(spec.client.url, clientJar, spec.client.sha1,
        b => this.emit({ stage: 'Ядро игры', bytes: b }));
    }

    // 2. libraries (+ natives)
    const libTasks = [], natTasks = [];
    for (const lib of spec.libraries) {
      const target = path.join(libsDir, lib.download.path);
      if (!fs.existsSync(target)) {
        (lib.native ? natTasks : libTasks).push({ ...lib.download, lib });
      }
    }
    if (libTasks.length) {
      onStage(`Библиотеки (${libTasks.length})…`);
      await this.fetchAll(libTasks, libsDir, 'Библиотеки');
    }

    // 3. natives: download then extract jar contents into natives dir
    const natFiles = [];
    if (natTasks.length) {
      onStage(`Нативные библиотеки (${natTasks.length})…`);
      await this.fetchAll(natTasks, libsDir, 'Нативы');
    }
    for (const t of natTasks) natFiles.push(path.join(libsDir, t.path));
    // also already-downloaded natives from previous runs
    for (const lib of spec.libraries) {
      if (lib.native) {
        const p = path.join(libsDir, lib.download.path);
        if (fs.existsSync(p) && !natFiles.includes(p)) natFiles.push(p);
      }
    }
    for (const nf of natFiles) {
      try {
        const zip = new AdmZip(nf);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectoryName) continue;
          if (/\/META-INF\//.test(entry.entryName)) continue;
          const out = path.join(nativesDir, path.basename(entry.entryName));
          if (!fs.existsSync(out)) fs.writeFileSync(out, entry.getData());
        }
      } catch (e) { console.error('[natives]', nf, e.message); }
    }

    // 4. log4j config
    let log4jPath = null;
    if (spec.logging) {
      log4jPath = path.join(assetsDir, 'log4j2.xml');
      if (!fs.existsSync(log4jPath)) {
        try { await downloadOne(spec.logging, log4jPath, null); } catch { log4jPath = null; }
      }
    }

    // 5. asset index + objects (+ virtual tree for old versions)
    let assetIndexFile = null;
    if (spec.assetIndex) {
      const idxDir = ensureDir(path.join(assetsDir, 'indexes'));
      assetIndexFile = path.join(idxDir, `${spec.assetIndex.id}.json`);
      if (!fs.existsSync(assetIndexFile)) {
        await downloadOne(spec.assetIndex.url, assetIndexFile, null);
      }
      const index = JSON.parse(fs.readFileSync(assetIndexFile, 'utf8'));
      const objects = [];
      const mapOrVirtual = !!index.map_to_resources || parseFloat(spec.id) < 1.7 || spec.assets === 'pre-1.7';
      for (const [name, info] of Object.entries(index.objects || {})) {
        const hash = info.hash;
        const objPath = path.join(assetsDir, 'objects', hash.slice(0, 2), hash);
        if (!fs.existsSync(objPath)) {
          objects.push({ url: `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`,
                         sha1: hash, size: info.size, path: path.join(hash.slice(0, 2), hash) });
        }
        if (mapOrVirtual) {
          // virtual tree is built after all objects are downloaded (second pass below)
        }
      }
      if (objects.length) {
        onStage(`Ресурсы: ${objects.length} файлов (~${Math.round(objects.reduce((s,o)=>s+(o.size||0),0)/1048576)} МБ)…`);
        await this.fetchAll(objects, path.join(assetsDir, 'objects'), 'Ресурсы');
      }
      if (mapOrVirtual) {
        // second pass: create virtual copies that failed as symlinks before download
        const virtDir = ensureDir(path.join(assetsDir, 'virtual', spec.assets));
        for (const [name, info] of Object.entries(index.objects || {})) {
          const vp = path.join(virtDir, name);
          if (fs.existsSync(vp)) continue;
          const objPath = path.join(assetsDir, 'objects', info.hash.slice(0, 2), info.hash);
          if (!fs.existsSync(objPath)) continue;
          ensureDir(path.dirname(vp));
          try { fs.linkSync(objPath, vp); } catch { try { fs.copyFileSync(objPath, vp); } catch {} }
        }
      }
    }

    // classpath
    const classpath = [];
    for (const lib of spec.libraries) {
      const p = path.join(libsDir, lib.download.path);
      if (fs.existsSync(p)) classpath.push(p);
    }
    classpath.push(clientJar);

    return { clientJar, nativesDir, log4jPath, assetIndexFile, classpath, assetsDir };
  }
}

module.exports = { Downloader, downloadOne, sha1File, ensureDir };
