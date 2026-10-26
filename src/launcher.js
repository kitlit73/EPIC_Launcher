'use strict';
/*
 * Launch: build the full java command line (modern `arguments` + legacy
 * minecraftArguments, natives, classpath, asset dir) and spawn the game.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function isLegacy(versionId) {
  // b1.x / a1.x / infdev / 0.x / 1.0-1.5 style arguments
  return /^(b|a|inf|rd|c)/.test(versionId) || /^0\./.test(versionId) ||
         ['1.0','1.0.0','1.1','1.2','1.2.1','1.2.2','1.2.3','1.2.4','1.2.5',
          '1.3','1.3.1','1.3.2','1.4','1.4.1','1.4.2','1.4.3','1.4.4','1.4.5',
          '1.4.6','1.4.7','1.5','1.5.1','1.5.2'].includes(versionId);
}

function buildArgs(spec, paths, opts) {
  const { auth, gameDir, javaPath, ramGB, extraJvm = '', fullscreen, serverIp } = opts;
  const assetsRoot = paths.assetsDir;
  const virtualAssetDir = path.join(assetsRoot, 'virtual', spec.assets);
  const useVirtual = fs.existsSync(virtualAssetDir);

  const map = {
    '${auth_player_name}': auth.nick,
    '${auth_uuid}': auth.uuid,
    '${auth_access_token}': auth.token,
    '${auth_xuid}': auth.xuid || '0',
    '${client_token}': auth.clientToken || '00000000000000000000000000000000',
    '${user_properties}': JSON.stringify(auth.properties || { textures: {} }),
    '${user_type}': auth.type === 'microsoft' ? 'msa' : 'legacy',
    '${version_name}': spec.id,
    '${game_directory}': gameDir,
    '${assets_root}': assetsRoot,
    '${assets_index_name}': spec.assetIndex ? spec.assetIndex.id : spec.assets,
    '${game_assets}': useVirtual ? virtualAssetDir : assetsRoot,
    '${auth_session}': auth.token,
    '${launch_target}': spec.launchTarget || 'client',
    '${natives_directory}': paths.nativesDir,
    '${launcher_name}': 'epic-launcher',
    '${launcher_version}': '2.0.0',
    '${classpath_separator}': process.platform === 'win32' ? ';' : ':',
    '${library_path}': paths.classpath.join(process.platform === 'win32' ? ';' : ':'),
    '${version_type}': spec.type,
    '${resolution_width}': '1280',
    '${resolution_height}': '720',
    '${icon}': '',
    '${quickPlayPath}': '',
    '${quickPlaySingleplayer}': '',
    '${quickPlayMultiplayer}': serverIp || '',
    '${quickPlayRealms}': '',
    '${log4j_config}': paths.log4jPath || '',
    '${classpath}': paths.classpath.join(process.platform === 'win32' ? ';' : ':'),
  };

  const subst = s => {
    let out = s;
    for (const [k, v] of Object.entries(map)) out = out.split(k).join(String(v));
    return out;
  };

  const jvm = [];
  // memory + modern G1GC flags
  jvm.push(`-Xmx${Math.round(ramGB)}G`, `-Xms${Math.max(1, Math.round(ramGB / 4))}G`);
  if (parseInt(spec.javaMajor, 10) >= 17 && !isLegacy(spec.id)) {
    jvm.push('-Djava.net.preferIPv4Stack=true');
  }
  if (extraJvm.trim()) jvm.push(...extraJvm.trim().split(/\s+/));

  // Diagnostic JVM options break the JVM unless preceded by -XX:+UnlockDiagnosticVMOptions.
  // Strip them defensively (they are never needed to run the game).
  const DIAGNOSTIC = /^-XX:(GuaranteedSafepointInterval|MaxJavaStackTraceDepth|CompileCommand|OnThrow|PrintCompilation|Trace.*|Dump.*|AbortVMOnException.*)=/;
  const isDiagOrUnlock = a => DIAGNOSTIC.test(a) || a === '-XX:+UnlockDiagnosticVMOptions' || a === '-XX:-UnlockDiagnosticVMOptions';

  for (const raw of spec.argsJvm) {
    const a = subst(raw);
    if (a.includes('${log4j_config}') && !paths.log4jPath) continue; // skip if no config file
    if (a === '') continue;
    if (isDiagOrUnlock(a)) continue;
    jvm.push(a);
  }

  const game = spec.argsGame.map(subst).filter(Boolean);

  // legacy argument names used by old versions
  if (isLegacy(spec.id)) {
    const legacyMap = {
      '--username': auth.nick, '--session': auth.token, '--has_microsoft': null,
      '--version': spec.id, '--gameDir': gameDir, '--assetsDir': assetsRoot,
      '--assetIndex': map['${assets_index_name}'], '--uuid': auth.uuid,
      '--accessToken': auth.token, '--userType': map['${user_type}'],
      '--userProperties': '{}',
    };
    const out = [];
    for (let i = 0; i < game.length; i++) {
      const tok = game[i];
      if (tok.startsWith('--') && tok in legacyMap) {
        const v = legacyMap[tok];
        if (v !== null) { out.push(tok); if (typeof v === 'string') out.push(v); }
        i++; // consume its value too
      } else out.push(tok);
    }
    game.length = 0; game.push(...out);
  }

  if (fullscreen) game.push('--fullscreen');
  if (serverIp) game.push('--server', serverIp, '--port', '25565');

  // If the version's own argsJvm already carries -cp / classpath (modern format),
  // don't append another one.
  const hasCp = jvm.some(a => a === '-cp' || a === '-classpath');
  const finalJvm = jvm.filter(a => a !== '');
  const tail = hasCp ? [] : ['-cp', map['${classpath}']];
  return [javaPath, ...finalJvm, ...tail, spec.mainClass, ...game];
}

function launch(cmd, gameDir, onData, onExit) {
  const javaBin = cmd[0];
  const args = cmd.slice(1);
  console.log('[launch]', javaBin, args.length, 'args');
  const child = spawn(javaBin, args, { cwd: gameDir, detached: false });
  child.stdout.on('data', d => onData(d.toString()));
  child.stderr.on('data', d => onData(d.toString()));
  child.on('error', e => onExit({ error: e.message }));
  child.on('exit', code => onExit({ code }));
  return child;
}

module.exports = { buildArgs, launch, isLegacy };
