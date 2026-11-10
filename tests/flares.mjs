import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';

globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({persist:false,read:async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)))});
const points=[[0,0],[320,240],[640,480],[100,300],[500,100],[322,241],[-100,700]];
// Execute the original sprite routine's fld/fadd/fmul in Unicorn. Return its
// angle before fstp, independently of the patched translator and C helper.
const cases=points.map(([x,y])=>{
  const xy=Buffer.alloc(8);xy.writeFloatLE(x);xy.writeFloatLE(y,4);
  return {entry:0x45175c,registers:[0,0,0,0,0,0x20000,0,0],float:true,
    memory:[{address:0x20000,hex:xy.toString('hex')},{address:0x451768,hex:'c3'}]};
});
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,
  [new URL('./x86_oracle.py',import.meta.url).pathname],
  {input:JSON.stringify({cases,memorySize:runtime.memorySize}),encoding:'utf8'});
assert.equal(oracle.status,0,oracle.stderr);
const expected=JSON.parse(oracle.stdout),sizes=[[640,480],[1280,960],[3840,2880],[6144,4608],
  [1280,720],[3840,2160],[6144,3162],[5120,1440],[1080,1920],[2160,3840]];
let checks=0;
try{
  const m=runtime.module;
  for(const [width,height]of sizes){
    m._web_projection_update(width,height);
    const virtualWidth=new Float32Array(m.HEAPU8.buffer,m._web_projection_state(),3)[0];
    for(const [i,[x,y]]of points.entries()){
      // The same view-angle displacement from the centre, projected to each
      // physical resolution, must keep the original 640x480 rotation.
      const px=(x-320)*width/virtualWidth+width/2,py=(y-240)*width/virtualWidth+height/2;
      assert(Math.abs(m._web_flare_angle(px+py)-expected[i].float)<1e-12,`Native flare angle ${width}x${height}, ${x},${y}`);checks++;
    }
  }
  m._web_projection_update(640,480);
  for(const [i,[x,y]]of points.entries())assert.equal(m._web_flare_angle(x+y),expected[i].float,'640x480 preserves the original instruction result');
}finally{runtime.dispose();}
await writeFile('build/flare-differential.json',JSON.stringify({checks,sizes,passed:true})+'\n');
console.log(`${checks} native sprite-angle comparisons passed across pixel densities and wide/portrait projections`);
