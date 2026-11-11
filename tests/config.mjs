import assert from 'node:assert/strict';
import {openingMovies,softwareViewport,sceneDetail,sceneDetailMode,savedSceneDetail,touchViewport,savedSkyboxes} from '../web/config.mjs';
import {selectAdapter} from '../web/renderer.mjs';
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
assert.deepEqual(softwareViewport({width:320,height:568},Infinity),{width:640,height:1136});
assert.deepEqual(softwareViewport({width:7680,height:4320},Infinity,4096),{width:4096,height:2304});
console.log('9 viewport display checks passed (pixel budget, aspect, minimum size and adapter limits)');
const touchLimit=1440*810;
assert.deepEqual(touchViewport({width:1290,height:2796},touchLimit),{width:1244,height:933});
assert.deepEqual(touchViewport({width:2796,height:1290},touchLimit),{width:1244,height:933});
assert.deepEqual(touchViewport({width:320,height:568},touchLimit),{width:644,height:483});
assert.equal(savedSkyboxes(),false,'Atmospheric skies require an opt-in');
const hardwareAdapter={info:{isFallbackAdapter:false}},softwareAdapter={info:{isFallbackAdapter:true}},requests=[];
assert.equal(await selectAdapter({requestAdapter:async options=>{requests.push(options);return options.powerPreference==='low-power'?hardwareAdapter:softwareAdapter;}}),hardwareAdapter);
assert.equal(requests.length,2);assert(requests.every(options=>options.forceFallbackAdapter===false));
assert.equal(await selectAdapter({requestAdapter:async()=>softwareAdapter}),softwareAdapter);
assert.equal(await selectAdapter({requestAdapter:async options=>{if(options.featureLevel)return hardwareAdapter;throw new Error('Unavailable');}}),hardwareAdapter);
assert.equal(await selectAdapter({requestAdapter:async()=>null}),undefined);
console.log('Adapter selection prefers hardware across browser hints and retains software only as a fallback');

for(const touch of [false,true])for(const software of [false,true]) {
  const device={touch,software};
  assert.equal(sceneDetailMode('auto',device),touch||software?0:1);
  for(const [setting,mode]of [['original',0],['far',1],['very-far',2]])assert.equal(sceneDetailMode(setting,device),mode);
}
assert.equal(sceneDetail('corrupt'),'auto');
assert.equal(savedSceneDetail({getItem:()=>{throw new Error('Storage blocked');}}),'auto');
assert.equal(savedSceneDetail({getItem:()=>null}),'auto');
assert.equal(savedSceneDetail({getItem:key=>key==='nfs5-scene-detail'?'very-far':null}),'very-far');
console.log('Scene-detail defaults protect touch/software devices; explicit overrides and unavailable storage are supported');
