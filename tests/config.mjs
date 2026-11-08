import assert from 'node:assert/strict';
import {openingMovies} from '../web/config.mjs';
const bytes=s=>new TextEncoder().encode(s);
for(const [text,expected] of [
  ['',true],['[NFS5]\nNoMovies=1',false],['[NFS5]\nNoMovies=0',true],
  ['[Other]\nNoMovies=1',true],['; comment\r\n [nFs5] \r\n noMovies = 1',false],
  ['[NFS5]\nNoMovies="1"',false],['[NFS5]\nNoMovies=garbage',true],
  ['\uFEFF[NFS5]\nNoMovies=1',false],
])assert.equal(openingMovies(bytes(text)),expected);
assert.equal(openingMovies(null),true);
assert.equal(openingMovies(Uint8Array.from([255,254,...Buffer.from('[NFS5]\r\nNoMovies=1','utf16le')])),false);
console.log('10 startup configuration checks passed (NoMovies, section/key casing, defaults, BOM encodings)');
