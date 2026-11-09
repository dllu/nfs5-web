import {attachInput} from './input.mjs';
import {openAudio} from './audio.mjs';

const loading=document.querySelector('#loading'), status=document.querySelector('#status');
const retry=document.querySelector('#retry'), failure=document.querySelector('#failure');
const sound=document.querySelector('#sound');
retry.onclick=()=>location.reload();
let worker,audio,detach,screen,logs=[],finished=false;
const resume=()=>audio?.resume().then(()=>{sound.hidden=audio.stats().state==='running';}).catch(()=>{});
window.addEventListener('pointerdown',resume,{capture:true});
window.addEventListener('keydown',resume,{capture:true});
async function finish(message,error) {
  if(finished)return;finished=true;
  detach?.();worker?.terminate();await audio?.close();
  sound.hidden=true;loading.hidden=false;status.textContent=message;retry.hidden=false;
  if(error){failure.hidden=false;document.querySelector('#error').textContent=error+'\n\n'+logs.slice(-12).join('\n');}
}
try {
  if(!crossOriginIsolated)throw new Error('Shared memory is unavailable. The server must enable cross-origin isolation.');
  if(!navigator.gpu)throw new Error('WebGPU is unavailable. Use a browser with WebGPU enabled on a supported GPU.');
  audio=await openAudio({waitForResume:false});
  sound.hidden=audio.stats().state==='running';
  let canvas=document.querySelector('#game');
  worker=new Worker(new URL('./runner.mjs',import.meta.url),{type:'module'});
  worker.onerror=event=>finish('Unable to run the game',event.message);
  worker.onmessage=({data})=>{
    if(data.type==='log'){
      logs.push(data.text);if(logs.length>32)logs.shift();
      if(data.text.startsWith('Mounted'))status.textContent='Starting game…';
    }
    if(data.type==='error')finish('Unable to run the game',data.error);
    if(data.type==='loaded') {
      detach=attachInput(window,event=>{
        if(screen){
          const box=canvas.getBoundingClientRect();
          if('x'in event){event.x=Math.round((event.x-box.left)*screen.width/box.width);event.y=Math.round((event.y-box.top)*screen.height/box.height);}
          if('dx'in event){event.dx=Math.round(event.dx*screen.width/box.width);event.dy=Math.round(event.dy*screen.height/box.height);}
        }
        worker.postMessage(event);
      });
    }
    if(data.type==='screen'){screen=data;loading.hidden=true;canvas.focus({preventScroll:true});}
    if(data.type==='save-error'){sound.hidden=false;sound.textContent='Local save failed. Keep this tab open and free some browser storage.';}
    if(data.type==='result'){
      data.frame?.close();
      const r=data.result;
      finish(r.exited?'Game saved. See you on the road.':'The game stopped.',r.exited?null:r.error);
    }
  };
  const offscreen=canvas.transferControlToOffscreen();
  worker.postMessage({type:'start',milliseconds:0,intro:false,audio:audio.configuration,
    display:{width:Math.round(innerWidth*devicePixelRatio),height:Math.round(innerHeight*devicePixelRatio)},canvas:offscreen},[offscreen]);
  // Flush files already serialized by the game when the tab is backgrounded.
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&!finished)worker.postMessage({type:'checkpoint'});});
  window.addEventListener('pagehide',()=>{if(!finished)worker.postMessage({type:'checkpoint'});});
} catch(error) {await finish('Unable to start the game',error.stack||String(error));}
