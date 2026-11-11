import {attachInput} from './input.mjs';
import {openAudio} from './audio.mjs';
import {attachControls} from './controls.mjs';
import {savedSceneDetail,savedSkyboxes} from './config.mjs';
import {openStorage} from './storage.mjs';
import {createBackup,readBackup} from './backup.mjs';

const loading=document.querySelector('#loading'), status=document.querySelector('#status');
const retry=document.querySelector('#retry'), failure=document.querySelector('#failure');
const sound=document.querySelector('#sound'),performanceNotice=document.querySelector('#performance');
const saveWarning=document.querySelector('#save-warning'),backupFile=document.querySelector('#backup-file');
retry.onclick=()=>location.reload();
let worker,audio,detach,controls,screen,executable,logs=[],finished=false,completeCheckpoint,checkpointId=0,backupBusy=false;
const warnBeforeLeaving=event=>{if(!finished){event.preventDefault();event.returnValue='';}};
const displaySize=()=>({width:Math.round(innerWidth*devicePixelRatio),height:Math.round(innerHeight*devicePixelRatio)});
const touchPixelLimit=matchMedia('(pointer: coarse)').matches?1440*810:0;
const resume=()=>audio?.resume().then(()=>{sound.hidden=audio.stats().state==='running';}).catch(()=>{});
window.addEventListener('pointerdown',resume,{capture:true});
window.addEventListener('keydown',resume,{capture:true});
async function finish(message,error,saved=false) {
  if(finished)return;finished=true;
  completeCheckpoint?.(saved?null:'The game stopped before the save checkpoint finished.');
  window.removeEventListener('beforeunload',warnBeforeLeaving);
  controls?.close();detach?.();worker?.terminate();await audio?.close();
  sound.hidden=performanceNotice.hidden=saveWarning.hidden=true;
  document.querySelector('#instructions').hidden=true;
  document.querySelector('#backup-actions').hidden=false;
  loading.hidden=false;status.textContent=message;retry.hidden=false;
  if(error){failure.hidden=false;document.querySelector('#error').textContent=error+'\n\n'+logs.slice(-12).join('\n');}
}

function flushGame() {
  if(finished)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>completeCheckpoint?.('The game did not finish saving. Try again.'),15000);
    completeCheckpoint=error=>{
      clearTimeout(timeout);
      completeCheckpoint=null;
      if(error)reject(new Error(error));else resolve();
    };
    worker.postMessage({type:'checkpoint',reply:++checkpointId});
  });
}

function backupStatus(message) {
  for(const element of document.querySelectorAll('.backup-status')){
    element.textContent=message;
    element.hidden=!message;
  }
}

async function manageBackup(file) {
  if(backupBusy)return;
  backupBusy=true;
  const buttons=document.querySelectorAll('[data-backup]');
  for(const button of buttons)button.disabled=true;
  retry.disabled=true;
  backupStatus(file?'Reading backup…':'Preparing backup…');
  let storage;
  try {
    if(!executable){
      const response=await fetch('./manifest.json');
      if(!response.ok)throw new Error('Unable to identify this game build.');
      executable=(await response.json()).sha256;
    }
    storage=await openStorage(executable);
    if(!storage)throw new Error('Browser save storage is unavailable.');
    if(file){
      const records=await readBackup(file,executable);
      const note=finished?'Download your current saves first if you want to keep a copy.':
        'Cancel and quit through the game first if you want to save your current progress.';
      if(!confirm('Restore this backup and restart the game? This replaces all profiles and in-game settings saved in this browser.\n\n'+note)){
        backupStatus('');
        return;
      }
      await storage.replace(records);
      backupStatus('Backup restored. Restarting…');
      finished=true;
      window.removeEventListener('beforeunload',warnBeforeLeaving);
      location.reload();
    }else{
      await flushGame();
      const blob=createBackup(executable,await storage.load());
      const url=URL.createObjectURL(blob), link=document.createElement('a');
      link.href=url;
      link.download=`nfs5-saves-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      backupStatus('Backup download started.');
    }
  }catch(error){
    backupStatus(`${file?'Restore':'Download'} failed. ${error.message}`);
  }finally{
    storage?.close();
    for(const button of buttons)button.disabled=false;
    retry.disabled=false;
    backupBusy=false;
  }
}

document.addEventListener('click',event=>{
  if(backupBusy)return;
  const action=event.target.closest('[data-backup]')?.dataset.backup;
  if(action==='download')void manageBackup();
  if(action==='upload')backupFile.click();
});
backupFile.onchange=()=>{
  const file=backupFile.files[0];
  backupFile.value='';
  if(file)void manageBackup(file);
};

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
      executable=data.manifest.sha256;
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
    if(data.type==='checkpoint-result'&&data.reply===checkpointId)completeCheckpoint?.(data.error);
    if(data.type==='save-error'){saveWarning.hidden=false;saveWarning.textContent='Local save failed. '+data.error;}
    if(data.type==='result'){
      data.frame?.close();
      const r=data.result;
      finish(r.exited?'Game saved. See you on the road.':'The game stopped.',r.exited?null:r.error,r.exited);
    }
  };
  const offscreen=canvas.transferControlToOffscreen();
  worker.postMessage({type:'start',milliseconds:0,intro:false,softwarePixelLimit:1280*720,audio:audio.configuration,
    detail:savedSceneDetail(),skyboxes:savedSkyboxes(),touchPixelLimit,resizeRace:true,
    display:displaySize(),canvas:offscreen},[offscreen,audio.configuration.port]);
  window.addEventListener('beforeunload',warnBeforeLeaving);
  worker.postMessage({type:'visibility',visible:!document.hidden});
  const updateFocus=()=>{if(!finished)worker.postMessage({type:'focus',focused:document.hasFocus()});};
  window.addEventListener('focus',updateFocus);window.addEventListener('blur',updateFocus);updateFocus();
  let resizeTimer;
  const updateViewport=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!finished)worker.postMessage({type:'viewport',display:displaySize()});},150);};
  window.addEventListener('resize',updateViewport);
  for(const event of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(event,updateViewport);
  // Flush files already serialized by the game when the tab is backgrounded.
  document.addEventListener('visibilitychange',()=>{if(!finished){worker.postMessage({type:'visibility',visible:!document.hidden});if(document.hidden)worker.postMessage({type:'checkpoint'});}});
  window.addEventListener('pagehide',()=>{if(!finished)worker.postMessage({type:'checkpoint'});});
} catch(error) {await finish('Unable to start the game',error.stack||String(error));}
