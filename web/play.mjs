import {attachInput} from './input.mjs';
import {openAudio} from './audio.mjs';
import {attachControls} from './controls.mjs';
import {savedSceneDetail,savedSkyboxes,touchViewport} from './config.mjs';

const loading=document.querySelector('#loading'), status=document.querySelector('#status');
const retry=document.querySelector('#retry'), failure=document.querySelector('#failure');
const sound=document.querySelector('#sound'),performanceNotice=document.querySelector('#performance');
retry.onclick=()=>location.reload();
let worker,audio,detach,controls,screen,logs=[],finished=false;
const warnBeforeLeaving=event=>{if(!finished){event.preventDefault();event.returnValue='';}};
const displaySize=()=>({width:Math.round(innerWidth*devicePixelRatio),height:Math.round(innerHeight*devicePixelRatio)});
const touchPixelLimit=matchMedia('(pointer: coarse)').matches?1440*810:0;
const resume=()=>audio?.resume().then(()=>{sound.hidden=audio.stats().state==='running';}).catch(()=>{});
window.addEventListener('pointerdown',resume,{capture:true});
window.addEventListener('keydown',resume,{capture:true});
async function finish(message,error) {
  if(finished)return;finished=true;
  window.removeEventListener('beforeunload',warnBeforeLeaving);
  controls?.close();detach?.();worker?.terminate();await audio?.close();
  sound.hidden=performanceNotice.hidden=true;loading.hidden=false;status.textContent=message;retry.hidden=false;
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
      if(data.graphics?.software){
        performanceNotice.textContent=data.reducedResolution?'Software rendering detected. A lower default race resolution is enabled. Enable hardware acceleration or try another browser for full resolution.':'Software rendering detected. Enable hardware acceleration or try another browser for better performance.';
        performanceNotice.hidden=false;setTimeout(()=>{performanceNotice.hidden=true;},20000);
      }
      detach=attachInput(window,event=>{
        if(screen){
          const box=canvas.getBoundingClientRect();
          if('x'in event){event.x=Math.round((event.x-box.left)*screen.width/box.width);event.y=Math.round((event.y-box.top)*screen.height/box.height);}
          if('dx'in event){event.dx=Math.round(event.dx*screen.width/box.width);event.dy=Math.round(event.dy*screen.height/box.height);}
        }
        worker.postMessage(event);
      },{viewport:canvas,keepRunningOnBlur:true});
      controls=attachControls(detach,{skyboxes:data.skyboxes,onDiagnostics:()=>worker.postMessage({type:'diagnostics'}),onDetailChange:value=>{worker.postMessage({type:'detail',value});worker.postMessage({type:'diagnostics'});}});
      if(screen)controls.setScreen(screen);
    }
    if(data.type==='screen'){
      screen=data;controls?.setScreen(data);canvas.style.setProperty('--game-aspect',data.width/data.height);loading.hidden=true;
      // Opening a phone's keyboard resizes the viewport. Keep its text field
      // focused when the renderer acknowledges that resize.
      if(!document.activeElement?.closest('#controls'))canvas.focus({preventScroll:true});
    }
    if(data.type==='diagnostics')controls?.diagnostics({...data,audio:{...data.audio,...audio?.stats()},type:undefined});
    if(data.type==='save-error'){sound.hidden=false;sound.textContent='Local save failed. Keep this tab open and free some browser storage.';}
    if(data.type==='result'){
      data.frame?.close();
      const r=data.result;
      finish(r.exited?'Game saved. See you on the road.':'The game stopped.',r.exited?null:r.error);
    }
  };
  const offscreen=canvas.transferControlToOffscreen();
  const display=displaySize();
  worker.postMessage({type:'start',milliseconds:0,intro:false,softwarePixelLimit:1280*720,audio:audio.configuration,
    detail:savedSceneDetail(),skyboxes:savedSkyboxes(),touchPixelLimit,
    display:touchPixelLimit?touchViewport(display,touchPixelLimit):display,canvas:offscreen},[offscreen,audio.configuration.port]);
  window.addEventListener('beforeunload',warnBeforeLeaving);
  worker.postMessage({type:'visibility',visible:!document.hidden});
  const updateFocus=()=>{if(!finished)worker.postMessage({type:'focus',focused:document.hasFocus()});};
  window.addEventListener('focus',updateFocus);window.addEventListener('blur',updateFocus);updateFocus();
  let resizeTimer;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!finished)worker.postMessage({type:'viewport',display:displaySize()});},150);});
  // Flush files already serialized by the game when the tab is backgrounded.
  document.addEventListener('visibilitychange',()=>{if(!finished){worker.postMessage({type:'visibility',visible:!document.hidden});if(document.hidden)worker.postMessage({type:'checkpoint'});}});
  window.addEventListener('pagehide',()=>{if(!finished)worker.postMessage({type:'checkpoint'});});
} catch(error) {await finish('Unable to start the game',error.stack||String(error));}
