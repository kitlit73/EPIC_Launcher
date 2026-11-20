'use strict';
/*
 * EPIC Account — авторизация через API-сервер (server/, деплой Render).
 *
 * Лаунчер НЕ подключается к базе напрямую: только HTTPS-запросы к API.
 * База (PostgreSQL в Neon) скрыта за сервером.
 *
 * API:
 *   POST /api/auth/register { username, password } -> 201 { user: { id, username, uuid } }
 *   POST /api/auth/login    { username, password } -> 200 { token, user }
 *   GET  /api/me            Authorization: Bearer  -> 200 { user }
 *   GET  /health                                    -> 200 { ok: true }
 *
 * Базовый URL: переменная EPIC_API_URL (можно задать в корневом .env),
 * по умолчанию — адрес Render-сервиса.
 */

const fs = require('fs');
const path = require('path');
const { smartFetch } = require('./net');

const DEFAULT_API_URL = 'https://epic-launcher-server.onrender.com';

// Читаем EPIC_API_URL из корневого .env (если задан) — так же, как раньше
// читался DATABASE_URL. Значение в .env перекрывает дефолт, переменная
// окружения перекрывает .env.
(function loadEnv() {
  try {
    const f = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(f)) return;
    const txt = fs.readFileSync(f, 'utf8');
    const m = txt.match(/^\s*EPIC_API_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    if (m && !process.env.EPIC_API_URL) process.env.EPIC_API_URL = m[1].trim();
  } catch (e) {
    console.warn('[epicAuth] не удалось прочитать .env:', e.message);
  }
})();

const API_URL = String(process.env.EPIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

async function apiFetch(pathname, { method = 'GET', body, token } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    // smartFetch: под Electron это net.fetch (учитывает системный прокси).
    // Обычный undici-fetch прокси Windows игнорирует — без него доступ к
    // Render на сетях с прокси даёт "fetch failed"/таймаут.
    res = await smartFetch(API_URL + pathname, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error('Сервер EPIC недоступен');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }

  if (res.ok) return data;

  // Дружелюбные ошибки для UI: без внутренних деталей сервера.
  const err = new Error(
    res.status === 401 ? 'Неверный ник или пароль'
      : res.status === 409 ? 'Ник уже занят'
        : res.status === 400 ? (data.error || 'Некорректные данные')
          : res.status === 429 ? 'Слишком много попыток — подождите немного'
            : res.status >= 500 ? 'Сервер EPIC временно недоступен'
              : (data.error || `Ошибка ${res.status}`)
  );
  err.status = res.status;
  throw err;
}

function accountFromUser(user, token) {
  // token передаётся только при логине; у регистрации токена нет —
  // после регистрации IPC-слой сразу делает авто-логин.
  return {
    type: 'epic',
    id: String(user.id),
    nick: user.username,
    uuid: user.uuid,
    token: token || null,
  };
}

class EpicAuth {
  constructor() {}

  /** Регистрация: возвращает пользователя БЕЗ токена (токен только на логине). */
  async register({ username, password }) {
    if (!username || !String(username).trim()) throw new Error('Введите ник');
    if (!password) throw new Error('Введите пароль');
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: { username: String(username).trim(), password: String(password) },
    });
    return data.user;
  }

  async login({ username, password }) {
    if (!username || !password) throw new Error('Введите ник и пароль');
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { username: String(username).trim(), password: String(password) },
    });
    return accountFromUser(data.user, data.token);
  }

  /**
   * Свежие данные пользователя по токену.
   *   { ok: true, user }        — токен валиден
   *   { ok: false, status: 401 }— токен невалиден/истёк (нужен повторный вход)
   *   { ok: false, status: 0 }  — сервер недоступен (работаем на сохранённых данных)
   */
  async me(token) {
    if (!token) return { ok: false, status: 0 };
    try {
      const data = await apiFetch('/api/me', { token });
      return { ok: true, user: data.user || null };
    } catch (e) {
      return { ok: false, status: e.status || 0 };
    }
  }

  /** Проверка связи с API (кнопка в UI). */
  async test() {
    try {
      await apiFetch('/health');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { EpicAuth, API_URL };
