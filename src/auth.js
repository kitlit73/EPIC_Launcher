'use strict';
/*
 * Auth: Microsoft account flow (MSA -> Xbox Live -> XSTS -> Minecraft services
 * -> game profile) run entirely in the Electron MAIN process, so no CORS and
 * no client-secret exposure to the renderer. Tokens are cached on disk.
 * Also provides offline mode (legal for LAN/private play per Mojang EULA).
 */

const fs = require('fs');
const path = require('path');

const CLIENT_ID = 'e118ac46-24bb-4ba1-94c1-ee25aabc9302'; // official vanilla launcher client id
const AUTH_URL = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A1066&scope=XboxLive.signin%20offline_access`;
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile';

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error_description || data.message || `HTTP ${res.status}`);
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

class Auth {
  constructor(dir) { this.file = path.join(dir, 'auth.json'); }

  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return null; } }
  save(a) { fs.writeFileSync(this.file, JSON.stringify(a, null, 2)); }
  clear() { try { fs.unlinkSync(this.file); } catch {} }

  /** Offline profile. */
  offline(nick) {
    const a = { type: 'offline', nick, uuid: offlineUuid(nick), token: 'act_' + offlineUuid(nick).replace(/-/g, '') };
    this.save(a);
    return a;
  }

  startUrl() { return AUTH_URL; }

  /** Exchange auth code captured from the popup redirect. */
  async completeWithCode(code) {
    const tok = await jsonFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'authorization_code',
        code, redirect_uri: 'http://localhost:1066', scope: 'XboxLive.signin offline_access' }).toString(),
    });

    const xbl = await jsonFetch(XBL_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-xs-signature': 'x' },
      body: JSON.stringify({ Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${tok.access_token}` },
                             DependencyTitles: [], RsftIdentifier: 'UserAuthAttributeBase' }),
    });

    const xsts = await jsonFetch(XSTS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-xs-signature': `x${xbl.IssueInstant}` },
      body: JSON.stringify({ Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
                             DependencyTitles: [], EndPoint: 'https://minecraft.services' }),
    }).catch(e => {
      if (e.data && e.data.XErr === 2148916233) throw new Error('Аккаунт Майкрософт без игровой учётки Minecraft.');
      if (e.data && e.data.XErr === 2148916238) throw new Error('Учётка несовершеннолетняя — нужен родительский профиль.');
      throw e;
    });

    const mc = await jsonFetch(MC_LOGIN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken: `XBL3.0 x=${xbl.Uhs};${xsts.Token}`, userType: 'Xbox' }),
    });

    const prof = await jsonFetch(MC_PROFILE_URL, { headers: { Authorization: `Bearer ${mc.access_token}` } });

    const a = {
      type: 'microsoft', nick: prof.name,
      uuid: prof.id.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5'),
      token: mc.access_token, refresh: mc.refresh_token, expires: Date.now() + mc.expires_in * 1000,
      skins: prof.skins || [], capes: prof.capes || [],
    };
    this.save(a);
    return a;
  }

  async ensureValid() {
    const a = this.load();
    if (!a || a.type !== 'microsoft') return a;
    if (a.token && a.expires > Date.now() + 60_000) return a;
    try {
      const tok = await jsonFetch(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token',
          refresh_token: a.refresh, scope: 'XboxLive.signin offline_access' }).toString(),
      });
      return await this.completeWithRefreshedMsa(tok.access_token);
    } catch (e) {
      console.warn('[auth] refresh failed:', e.message);
      return a;
    }
  }

  async completeWithRefreshedMsa(msaToken) {
    const xbl = await jsonFetch(XBL_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-xs-signature': 'x' },
      body: JSON.stringify({ Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msaToken}` },
                             DependencyTitles: [], RsftIdentifier: 'UserAuthAttributeBase' }),
    });
    const xsts = await jsonFetch(XSTS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-xs-signature': `x${xbl.IssueInstant}` },
      body: JSON.stringify({ Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
                             DependencyTitles: [], EndPoint: 'https://minecraft.services' }),
    });
    const mc = await jsonFetch(MC_LOGIN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken: `XBL3.0 x=${xbl.Uhs};${xsts.Token}`, userType: 'Xbox' }),
    });
    const prof = await jsonFetch(MC_PROFILE_URL, { headers: { Authorization: `Bearer ${mc.access_token}` } });
    const old = this.load() || {};
    const a = {
      ...old, type: 'microsoft', nick: prof.name,
      uuid: prof.id.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5'),
      token: mc.access_token, refresh: mc.refresh_token, expires: Date.now() + mc.expires_in * 1000,
      skins: prof.skins || [], capes: prof.capes || [],
    };
    this.save(a);
    return a;
  }
}

/** Deterministic UUID from nickname (same scheme as vanilla offline mode). */
function offlineUuid(nick) {
  const crypto = require('crypto');
  const h = crypto.createHash('md5').update(`OfflinePlayer:${nick}`).digest();
  h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80;
  const s = [...h].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

module.exports = { Auth, offlineUuid };
