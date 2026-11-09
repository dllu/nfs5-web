// Browser regression fixture: run the original race without the frontend.
import {loadRuntime} from './runtime.mjs';
let runtime,run,ready=false;
self.onmessage=async({data})=>{
 try {
  if(data.type==='start'){
   runtime=await loadRuntime({canvas:data.canvas,persist:false,intro:false,display:data.display,onResize:(width,height)=>postMessage({type:'screen',width,height})});
   const args=`debugmode=0 fe=0 track_name=coastal linear_track=1 numcars=1 numplayerracecars=1 numopponentracecars=0 car[0].class=human width=${data.display.width} height=${data.display.height} depth=32 texturedetail=4 cardetail=4`;
   runtime.module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\nfs5.exe '+args+'\0'),runtime.base+0xb000);
   const r=runtime.graphics.renderer,present=r.present;
   r.present=()=>{present();if(!ready&&r.width===data.display.width&&r.stats.draws>2000){ready=true;postMessage({type:'ready'});}};
   run=runtime.runAsync(0).then(result=>postMessage({type:'result',result}));
  } else if(data.type==='input')runtime?.input(data);
  else if(data.type==='visibility')runtime?.graphics?.setVisible(data.visible);
  else if(data.type==='sample') {
   const r=runtime.graphics.renderer;postMessage({type:'sample',id:data.id,frames:r.stats.frames,draws:r.stats.draws,stats:r.stats,memory:runtime.module.HEAPU8.byteLength,ready});
  } else if(data.type==='stop'){runtime.stop();await run;runtime.dispose();postMessage({type:'stopped'});}
 } catch(error){postMessage({type:'error',error:error.stack||String(error)});}
};
