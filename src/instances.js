'use strict';
/*
 * Сборки (instances) в стиле Prism Launcher.
 *
 * Каждая сборка — отдельная директория instances/<id>/ с собственным
 * .minecraft/ (изолированные versions/, mods/, saves/, config/), но с ОБЩИМИ
 * для всех сборок libraries/ и assets/ из корневого .minecraft — чтобы не
 * качать сотни мегабайт заново для каждой сборки.
 *
 * Структура:
 *   instances/<id>/
 *     instance.json        — метаданные (имя, версия, загрузчик, ram, ...)
 *     .minecraft/          — игровой каталог сборки
 *       versions/          — версия игры/загрузчика этой сборки
 *       mods/ saves/ config/ ... — изолированы в сборке
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

let instancesRoot = null; // set from main.js: path.join(baseDir, 'instances')

function setInstancesRoot(dir) { instancesRoot = dir; }
function root() {
  if (!instancesRoot) throw new Error('instances root not configured');
  return instancesRoot;
}

function slugify(name) {
  return String(name || 'build')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'build';
}

function instanceDir(id) { return path.join(root(), slugify(id)); }
function instanceGameDir(id) { return path.join(instanceDir(id), '.minecraft'); }
function metaFile(id) { return path.join(instanceDir(id), 'instance.json'); }

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(metaFile(id), 'utf8'));
  } catch { return null; }
}

function writeMeta(id, meta) {
  fs.mkdirSync(instanceDir(id), { recursive: true });
  fs.writeFileSync(metaFile(id), JSON.stringify(meta, null, 2));
}

/** Все сборки (из папок instances/, у которых есть instance.json). */
function listInstances() {
  try {
    if (!fs.existsSync(root())) return [];
    return fs.readdirSync(root())
      .filter(id => fs.existsSync(metaFile(id)))
      .map(id => {
        const m = readMeta(id) || {};
        return { id, ...m };
      })
      .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  } catch (e) {
    console.error('[instances:list]', e.message);
    return [];
  }
}

/**
 * Создать сборку. Опции: { name, mcVersion, loader ('vanilla'|'fabric'|'forge'),
 * icon, ramGB, javaPath, extraJvm, fullscreen }.
 * Возвращает метаданные созданной сборки.
 */
function createInstance(opts) {
  const name = String(opts.name || 'Новая сборка').trim();
  const id = slugify(name);
  const dir = instanceDir(id);
  if (fs.existsSync(dir)) {
    throw new Error(`Сборка «${name}» уже существует (${id})`);
  }
  fs.mkdirSync(path.join(dir, '.minecraft', 'mods'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.minecraft', 'saves'), { recursive: true });
  const meta = {
    name,
    mcVersion: opts.mcVersion || '1.21.4',
    loader: opts.loader || 'vanilla',   // vanilla | fabric | forge
    loaderVersion: null,
    versionId: opts.mcVersion || '1.21.4',
    icon: opts.icon || '⛏',
    ramGB: opts.ramGB || 4,
    javaPath: opts.javaPath || null,
    extraJvm: opts.extraJvm || '',
    fullscreen: !!opts.fullscreen,
    created: Date.now(),
    lastPlayed: 0,
  };
  writeMeta(id, meta);
  return { id, ...meta };
}

function getInstance(id) {
  const m = readMeta(id);
  if (!m) throw new Error('Сборка не найдена');
  return { id, ...m };
}

function updateInstance(id, patch) {
  const dir = instanceDir(id);
  if (!fs.existsSync(metaFile(id))) throw new Error('Сборка не найдена');
  const meta = { ...(readMeta(id) || {}), ...patch, id: undefined };
  writeMeta(id, meta);
  fs.mkdirSync(dir, { recursive: true });
  return { id, ...meta };
}

function touch(id) {
  updateInstance(id, { lastPlayed: Date.now() });
}

function deleteInstance(id) {
  const dir = instanceDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Создать уникальный slug для дубликата (name (2), name (3), ...). */
function uniqueSlug(baseName) {
  let id = slugify(baseName);
  let n = 2;
  while (fs.existsSync(instanceDir(id))) {
    id = slugify(`${baseName} (${n})`);
    n++;
  }
  return id;
}

/** Дублировать сборку: копирует весь каталог + новый instance.json. */
function duplicateInstance(id, name) {
  const srcDir = instanceDir(id);
  if (!fs.existsSync(srcDir)) throw new Error('Сборка не найдена');
  const srcMeta = readMeta(id) || {};
  const newName = String(name || (srcMeta.name ? srcMeta.name + ' (копия)' : 'Копия')).trim();
  const newId = uniqueSlug(newName);
  fs.cpSync(srcDir, instanceDir(newId), { recursive: true, force: true });
  const meta = { ...srcMeta, name: newName, created: Date.now(), lastPlayed: 0 };
  writeMeta(newId, meta);
  return { id: newId, ...meta };
}

/** Экспорт сборки в zip (instance.json + .minecraft). */
function exportInstance(id, destZip) {
  const srcDir = instanceDir(id);
  if (!fs.existsSync(srcDir)) throw new Error('Сборка не найдена');
  const zip = new AdmZip();
  zip.addLocalFolder(srcDir, 'instance');
  fs.mkdirSync(path.dirname(destZip), { recursive: true });
  zip.writeZip(destZip);
  return destZip;
}

/** Импорт сборки из zip, созданного exportInstance. */
function importInstance(zipPath, name) {
  if (!fs.existsSync(zipPath)) throw new Error('Файл не найден: ' + zipPath);
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const metaEntry = entries.find(e => e.entryName === 'instance/instance.json');
  if (!metaEntry) throw new Error('Не похоже на файл сборки EPIC (нет instance/instance.json)');
  const srcMeta = JSON.parse(metaEntry.getData().toString('utf8'));
  const newName = String(name || (srcMeta.name || 'Импортированная')).trim();
  const newId = uniqueSlug(newName);
  zip.extractAllTo(instanceDir(newId), true);
  const meta = { ...srcMeta, name: newName, created: Date.now(), lastPlayed: 0 };
  writeMeta(newId, meta);
  return { id: newId, ...meta };
}

module.exports = {
  setInstancesRoot, root, instanceDir, instanceGameDir,
  listInstances, createInstance, getInstance, updateInstance, touch, deleteInstance,
  duplicateInstance, exportInstance, importInstance,
};
