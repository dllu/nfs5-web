import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const m=runtime.module,v=new DataView(m.HEAPU8.buffer,runtime.base);
let checks=0;
try{
  assert(runtime.manifest.patches.includes('browser-ui-layout'));
  assert(runtime.manifest.patches.includes('browser-scaled-ui'));
  assert(runtime.manifest.patches.includes('browser-logical-framebuffer'));
  const modes=[[320,240,320,240],[640,480,640,480],[800,600,640,480],
    [1024,768,640,480],[1280,720,853,480],[3840,2160,853,480],
    [6144,3456,853,480],[6144,3162,933,480],[3440,1440,1147,480],
    [5120,1440,1707,480],[1080,1920,640,1138],[1024,1024,640,640]];
  for(const [w,h,lw,lh]of modes){
    assert.deepEqual([m._web_ui_layout(w,h,0),m._web_ui_layout(w,h,1)],[lw,lh]);checks++;
    v.setUint32(0x60c900,lw,true);v.setUint32(0x60c81c,lh,true);
    // Run the actual game's anchor helper in the new coordinate space. Corner
    // margins and centered widgets keep their original relative placement.
    for(const [rect,expected]of [
      [[10,20,120,120],[10,20]],
      [[510,340,120,120],[Math.min(510+Math.max(lw-640,0),lw-120),Math.min(340+Math.max(lh-480,0),lh-120)]],
      [[260,20,120,120],[lw>640?Math.trunc(lw/2)-60:Math.min(260,lw-120),20]],
    ]){
      const result=runtime.call(0x41e480,...rect);
      assert.equal(result.status,0,result.error);
      assert.deepEqual([result.registers[0],result.registers[2]],expected,`Original HUD anchor ${w}x${h}: ${rect}`);checks++;
    }
  }
  assert.deepEqual([m._web_ui_extent(0),m._web_ui_extent(1)],[640,480]);
  for(const xy of [[0,0],[320,240],[-20,-15],[639,479]])for(let axis=0;axis<2;axis++){
    assert.equal(m._web_ui_coordinate(xy[axis],axis),xy[axis]);checks++;
  }
}finally{runtime.dispose();}
console.log(`${checks} UI layout checks passed (original HUD anchors, 4K/6K, widescreen, portrait and low resolution)`);
