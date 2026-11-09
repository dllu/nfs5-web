import assert from 'node:assert/strict';
import {openingMovies,softwareViewport} from '../web/config.mjs';
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

for(const [display,expected] of [
  [{width:3840,height:2160},{width:1280,height:720}],
  [{width:6144,height:3456},{width:1280,height:720}],
  [{width:1080,height:1920},{width:720,height:1280}],
  [{width:640,height:480},{width:640,height:480}],
  [{width:800,height:600},{width:800,height:600}],
])assert.deepEqual(softwareViewport(display,1280*720),expected);
assert.equal(softwareViewport(null,1280*720),null);
const hardware={width:6144,height:3456};assert.equal(softwareViewport(hardware,0),hardware);
console.log('7 software-adapter display checks passed (pixel budget, aspect, minimum size and opt-in)');
