// Browser regression fixture: run the original race without the frontend.
import {loadRuntime} from './runtime.mjs';
let runtime,run,ready=false;
self.onmessage=async({data})=>{
 try {
  if(data.type==='start'){
   // Optionally exercise the public pack while keeping this fixture in dist/.
   const read=data.assetsUrl?async name=>{
    if(name!=='./assets.json')return fetch(name);
    const index=await(await fetch(data.assetsUrl)).json();
    for(const entry of index.entries)entry.url=new URL(entry.url,data.assetsUrl).href;
    if(index.preload)index.preload.url=new URL(index.preload.url,data.assetsUrl).href;
    return new Response(JSON.stringify(index));
   }:undefined;
   runtime=await loadRuntime({canvas:data.canvas,audio:data.audio,persist:false,intro:false,detail:data.detail,display:data.display,read,onResize:(width,height)=>postMessage({type:'screen',width,height})});
   const opponents=data.opponents??0,car=data.car;
   let args=`debugmode=0 fe=0 track_name=${data.track??'coastal'} linear_track=1 numcars=${opponents+1} numplayerracecars=1 numopponentracecars=${opponents} car[0].class=${data.driver??'human'} width=${data.display.width} height=${data.display.height} depth=32 texturedetail=4 cardetail=4`;
   if(car)for(let i=0;i<=opponents;i++)args+=` car[${i}].filename=${car.filename} car[${i}].specname=${car.spec} car[${i}].aispecname=${car.ai} car[${i}].soundname=${car.sound}`;
   runtime.module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\nfs5.exe '+args+'\0'),runtime.base+0xb000);
   const r=runtime.graphics.renderer,present=r.present;
   r.present=(...args)=>{present(...args);if(!ready&&r.width===data.display.width&&r.stats.draws>2000){ready=true;postMessage({type:'ready'});}};
   run=runtime.runAsync(0).then(result=>postMessage({type:'result',result}));
  } else if(data.type==='input')runtime?.input(data);
  else if(data.type==='detail')runtime?.setDetail(data.value);
  else if(data.type==='resetTiming')runtime?.graphics?.renderer.resetTiming();
  else if(data.type==='visibility')runtime?.graphics?.setVisible(data.visible);
  else if(data.type==='focus')runtime?.graphics?.setFocused(data.focused);
  else if(data.type==='sample') {
   const r=runtime.graphics.renderer,m=runtime.module;postMessage({type:'sample',id:data.id,frames:r.stats.frames,draws:r.stats.draws,stats:r.stats,memory:m.HEAPU8.byteLength,ready,detail:runtime.detailStats(),timing:r.timing(),files:Array.from(new Float64Array(m.HEAPU8.buffer,m._web_fs_io_stats(),6)),fileActivity:runtime.fileActivity?.(),streaming:runtime.streamingStats(),pacing:runtime.graphics.pacing});
  } else if(data.type==='stop'){runtime.stop();await run;runtime.dispose();postMessage({type:'stopped'});}
 } catch(error){postMessage({type:'error',error:error.stack||String(error)});}
};
