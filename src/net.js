'use strict';
/*
 * fetch с поддержкой системного прокси.
 *
 * Глобальный fetch (undici в Node) игнорирует настройки прокси Windows
 * (ProxyEnable/ProxyServer) — соединения идут напрямую и на части хостов
 * (Render и др.) обрываются таймаутом, хотя PowerShell/браузер работают.
 *
 * Electron'овский net.fetch использует сетевой стек Chromium — системный
 * прокси и хранилище сертификатов учитываются автоматически.
 * Вне Electron (node-скрипты, тесты) — обычный global.fetch.
 */

let netModule = null;
try {
  const electron = require('electron');
  if (electron && typeof electron === 'object' && electron.net) netModule = electron.net;
} catch { /* не в Electron */ }

const impl = netModule && netModule.fetch ? netModule.fetch.bind(netModule) : global.fetch;

/** Тот же контракт, что у fetch(url, opts), но с прокси-совместимостью. */
async function smartFetch(url, opts = {}) {
  return impl(url, opts);
}

module.exports = { smartFetch };
