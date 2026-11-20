'use strict';
/*
 * Minecraft server-list ping (legacy protocol): TCP -> handshake -> status request
 * -> parse { version, players }. Used to show real ping/online count in the UI.
 */

const net = require('net');
const dns = require('dns');

const DEFAULT_PORT = 25565;

/*
 * Адрес сервера может быть:
 *   - "host"             — порт берётся из SRV-записи _minecraft._tcp.<host>,
 *                          если её нет — стандартный 25565;
 *   - "host:port"        — порт задан явно (например "Epic.servmine.top:25141");
 *   - "http://host[:p]/" — лишнее отрезаем.
 * Без этого серверы за SRV (нестандартный порт, как у EPIC — 25141) не
 * пингуются и не подключаются при быстром входе.
 */
function parseAddress(input) {
  const clean = String(input || '').trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/.*$/, '');
  if (!clean) return null;
  const m = clean.match(/^(.+):(\d+)$/);
  if (m) return { host: m[1].replace(/^\[|\]$/g, ''), port: parseInt(m[2], 10) };
  return { host: clean, port: null };
}

function resolveSrv(host) {
  return new Promise((resolve) => {
    dns.resolveSrv('_minecraft._tcp.' + host, (err, records) => {
      if (err || !Array.isArray(records) || !records.length) return resolve(null);
      records.sort((a, b) => (a.priority - b.priority) || (b.weight - a.weight));
      const r = records.find(x => x && x.name && x.port > 0);
      resolve(r ? { host: r.name, port: r.port } : null);
    });
  });
}

/** "Epic.servmine.top" -> { host, port } с учётом SRV и явного "host:port". */
async function resolveAddress(input) {
  const parsed = parseAddress(input);
  if (!parsed) return null;
  if (parsed.port) return parsed;             // явный порт — как написали, так и будет
  const srv = await resolveSrv(parsed.host);  // иначе ищем SRV-запись
  return srv || { host: parsed.host, port: DEFAULT_PORT };
}

function writeVarInt(num) {
  const out = [];
  while (true) {
    if ((num & ~0x7f) === 0) { out.push(num); break; }
    out.push((num & 0x7f) | 0x80);
    num >>>= 7;
  }
  return Buffer.from(out);
}

function readVarInt(buf, offset) {
  let result = 0, shift = 0;
  while (true) {
    if (offset >= buf.length) throw new Error('EOF');
    const b = buf[offset++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) throw new Error('VarInt too big');
  }
  return { value: result, offset };
}

/**
 * Пинг сервера. host может быть "host", "host:port" или "http://host:port".
 * port=null — адрес разрешается через SRV (или порт по умолчанию 25565).
 */
async function pingServer(host, port = null, timeout = 4000) {
  let addr = { host: String(host || '').trim(), port: port == null ? null : Number(port) };
  if (addr.port == null) {
    const resolved = await resolveAddress(addr.host);
    if (!resolved) return { ok: false, error: 'bad address' };
    addr = resolved;
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host: addr.host, port: addr.port });
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(res);
    };
    socket.setTimeout(timeout);
    socket.on('timeout', () => finish({ ok: false, error: 'timeout' }));
    socket.on('error', () => finish({ ok: false, error: 'error' }));

    // Handshake: packet id 0x00, protocol 47, host, port, next state 1
    const hostBuf = Buffer.from(addr.host, 'utf8');
    const handshake = Buffer.concat([
      writeVarInt(0),
      writeVarInt(47),
      writeVarInt(hostBuf.length), hostBuf,
      Buffer.from([addr.port >> 8, addr.port & 0xff]),
      writeVarInt(1),
    ]);
    const handshakePkt = Buffer.concat([writeVarInt(handshake.length), handshake]);
    const statusReq = Buffer.from([0x01, 0x00]); // length 1, packet id 0
    socket.write(Buffer.concat([handshakePkt, statusReq]));

    let data = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      try {
        const { value: len, offset } = readVarInt(data, 0);
        const pkt = data.subarray(offset, offset + len);
        if (pkt.length < len) return; // wait for more bytes
        const { offset: o2 } = readVarInt(pkt, 0); // packet id (1)
        const { value: strLen, offset: o3 } = readVarInt(pkt, o2);
        const json = pkt.subarray(o3, o3 + strLen).toString('utf8');
        const info = JSON.parse(json);
        finish({
          ok: true,
          online: info.players ? info.players.online : 0,
          max: info.players ? info.players.max : 0,
          version: info.version ? info.version.name : '',
        });
      } catch (e) { /* incomplete frame or bad json — keep waiting */ }
    });
    socket.on('close', () => finish({ ok: false, error: 'closed' }));
  });
}

module.exports = { pingServer, resolveAddress, resolveSrv, parseAddress, DEFAULT_PORT };
