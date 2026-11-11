import {fileKey} from './storage.mjs';

const format = 'nfs5-web-save-backup', version = 1;
const maxDataBytes = 64 * 1024 * 1024; // Guest filesystem write budget.
const maxBackupBytes = 128 * 1024 * 1024;
const ansi = new Set(new TextDecoder('windows-1252').decode(Uint8Array.from({length:256}, (_, i) => i)));
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

function encode(bytes) {
  const chunks = [], chunkSize = 24 * 1024; // Keep each call small and aligned to three bytes.
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
  }
  return chunks.join('');
}

export function createBackup(executable, records) {
  const files = records.map(({path, live, attributes, size, modifiedLow, modifiedHigh, data}) =>
    ({path, live, attributes, size, modifiedLow, modifiedHigh, data:data === null ? null : encode(data)}));
  return new Blob([JSON.stringify({format, version, executable, files})], {type:'application/json'});
}

function validPath(path) {
  if (typeof path !== 'string' || path.length > 1021 || !/^[CD]:\\/.test(path) ||
      /[\u0000-\u001f<>:"|/]/.test(path.slice(3)) || !Array.from(path).every(c => ansi.has(c))) return false;
  return path.length === 3 || path.slice(3).split('\\').every(part => part.length && !/[ .]$/.test(part));
}

export async function readBackup(file, executable) {
  if (file.size > maxBackupBytes) throw new Error('The backup file is too large.');
  let archive;
  try { archive = JSON.parse(await file.text()); }
  catch { throw new Error('Choose a save backup downloaded from this game.'); }
  if (archive?.format !== format || archive.version !== version || !Array.isArray(archive.files)) {
    throw new Error('This save backup format is unsupported.');
  }
  if (archive.executable !== executable) throw new Error('This backup was made with a different game executable.');
  const paths = new Set();
  let total = 0;
  return archive.files.map(record => {
    if (!record || !validPath(record.path)) throw new Error('The backup contains an invalid file path.');
    const {path, live, attributes, size, modifiedLow, modifiedHigh, data} = record;
    const key = fileKey(path);
    if (paths.has(key)) throw new Error('The backup contains duplicate file paths.');
    paths.add(key);
    if (typeof live !== 'boolean' || ![attributes, size, modifiedLow, modifiedHigh].every(uint32)) {
      throw new Error('The backup contains invalid file metadata.');
    }
    let bytes = null;
    if (data !== null) {
      if (!live || (attributes & 16) || typeof data !== 'string' || data.length !== Math.ceil(size / 3) * 4) {
        throw new Error('The backup contains invalid file data.');
      }
      total += size;
      if (total > maxDataBytes) throw new Error('The backup exceeds the game’s save storage limit.');
      let decoded;
      try { decoded = atob(data); }
      catch { throw new Error('The backup contains invalid file data.'); }
      if (decoded.length !== size) throw new Error('The backup contains invalid file data.');
      bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = decoded.charCodeAt(i);
    }
    return {path, live, attributes, size, modifiedLow, modifiedHigh, data:bytes};
  });
}
