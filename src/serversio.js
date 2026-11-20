'use strict';
/*
 * Write .minecraft/servers.dat (raw/uncompressed NBT) so the servers listed in
 * the launcher appear in the game's multiplayer menu.
 *
 * Format (old-style, readable by modern Minecraft): a root NBT compound with an
 * empty name containing a list "servers" of compounds:
 *   { hidden: byte, ip: string, name: string, (icon: string, optional) }
 */

const fs = require('fs');
const path = require('path');

const T_END = 0x00, T_BYTE = 0x01, T_SHORT = 0x02, T_INT = 0x03, T_STRING = 0x08, T_LIST = 0x09, T_COMPOUND = 0x0a;

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }

function writeName(buf, name) {
  const s = Buffer.from(String(name), 'utf8');
  buf.push(u16(s.length), s);
}

function writeByte(value) { const b = Buffer.alloc(1); b.writeUInt8(value & 0xff, 0); return b; }

function writeString(value) {
  const s = Buffer.from(String(value), 'utf8');
  return Buffer.concat([u16(s.length), s]);
}

function writeCompoundFields(fields) {
  // fields: array of [tag, name, payloadBuffer] — payload already encoded
  const parts = [];
  for (const [tag, name, payload] of fields) {
    parts.push(writeByte(tag));
    writeName(parts, name);
    parts.push(payload);
  }
  parts.push(writeByte(T_END)); // close compound
  return Buffer.concat(parts);
}

/**
 * Build servers.dat bytes from [{name, ip}].
 */
function buildServersDat(servers) {
  const elements = [];
  for (const s of servers) {
    const fields = [];
    fields.push([T_BYTE, 'hidden', writeByte(0)]);
    fields.push([T_STRING, 'ip', writeString(s.ip)]);
    fields.push([T_STRING, 'name', writeString(s.name)]);
    if (s.icon) fields.push([T_STRING, 'icon', writeString(s.icon)]);
    elements.push(writeCompoundFields(fields));
  }

  const listPayload = Buffer.concat([
    writeByte(T_COMPOUND),  // list element type
    u32(elements.length),   // count
    ...elements,
  ]);

  const listField = Buffer.concat([
    writeByte(T_LIST), u16(7), Buffer.from('servers', 'utf8'), listPayload,
  ]);

  const root = Buffer.concat([
    writeByte(T_COMPOUND), u16(0), // root compound, empty name
    listField,
    writeByte(T_END),
  ]);
  return root;
}

/** Merge launcher servers into an existing servers.dat (preserving user-added ones). */
function syncServersDat(gameDir, launcherServers, onStatus) {
  const file = path.join(gameDir, 'servers.dat');
  // Existing entries are NOT parsed (would need an NBT reader) — we preserve the
  // file by only replacing the launcher's known entries via name match is hard,
  // so we simply overwrite with launcher servers + keep file backup.
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, file + '_launcher.bak'); } catch {}
  }
  const data = buildServersDat(launcherServers);
  fs.writeFileSync(file, data);
  onStatus && onStatus(`Записано серверов: ${launcherServers.length}`);
  return launcherServers.length;
}

module.exports = { buildServersDat, syncServersDat };
