// Raw CDP avoids Playwright's per-session focus override, which keeps tabs visible.
import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
const require=createRequire(import.meta.url),{ws:WebSocket}=require('../node_modules/playwright-core/lib/utilsBundle.js');
process.env.TMPDIR=resolve('.cache/tmp');process.env.XDG_CACHE_HOME=resolve('.cache/xdg');process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');await mkdir(process.env.TMPDIR,{recursive:true});
await copyFile('tests/race-worker.mjs','dist/race-check-worker.mjs');
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const child=spawn(process.env.NFS5_CHROME??'/usr/bin/google-chrome',['--remote-debugging-port='+port,'--remote-allow-origins=http://localhost','--user-data-dir='+resolve('.cache/chrome-race-usability-raw'),'--no-sandbox','--no-first-run','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes'),'about:blank'],{stdio:'ignore'});
let socket,next=0;const pending=new Map(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(100);}throw new Error('Browser race condition timed out');}
try {
 const version=await until(()=>fetch(`http://127.0.0.1:${port}/json/version`).then(r=>r.json()).catch(()=>null),15000);
 socket=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});
 socket.on('message',raw=>{const m=JSON.parse(String(raw));if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));});}
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const command=(method,params)=>send(method,params,sessionId);
 await command('Page.enable');await command('Runtime.enable');await command('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
 await command('Page.navigate',{url:process.env.NFS5_TEST_URL??'http://127.0.0.1:8000'});
 await until(()=>evaluate('document.readyState==="complete"&&!!document.querySelector("#viewport-style")'));
 await evaluate(`(async()=>{
  document.body.innerHTML='<canvas id="game" width="640" height="480" tabindex="0"></canvas>';document.querySelector('#viewport-style').media='all';
  const {attachInput}=await import('./input.mjs'),canvas=document.querySelector('canvas');window.messages=[];
  window.worker=new Worker('./race-check-worker.mjs',{type:'module'});window.worker.onmessage=({data})=>{window.messages.push(data);if(data.type==='screen')canvas.style.setProperty('--game-aspect',data.width/data.height);};
  window.input=attachInput(window,e=>window.worker.postMessage(e),{viewport:canvas,keepRunningOnBlur:true});
  document.addEventListener('visibilitychange',()=>window.worker.postMessage({type:'visibility',visible:!document.hidden}));
  for(const type of ['focus','blur'])window.addEventListener(type,()=>window.worker.postMessage({type:'focus',focused:document.hasFocus()}));
  const offscreen=canvas.transferControlToOffscreen();window.worker.postMessage({type:'start',canvas:offscreen,display:{width:1280,height:720}},[offscreen]);
 })()`);
 async function sample(id){await evaluate(`window.worker.postMessage({type:'sample',id:${JSON.stringify(id)}})`);return until(()=>evaluate(`window.messages.find(m=>m.type==='sample'&&m.id===${JSON.stringify(id)})`));}
 await until(()=>evaluate('window.messages.some(m=>m.type==="screen"&&m.width===1280)'));
 const before=await sample('before-hidden');
 const other=await send('Target.createTarget',{url:'about:blank'});await send('Target.activateTarget',{targetId:other.targetId});
 await until(()=>evaluate('document.hidden'),10000);await sleep(4000);
 const hidden=await sample('hidden');assert(hidden.frames>before.frames+2,'Loading must present new artwork while the tab is hidden');
 await send('Target.activateTarget',{targetId});await send('Target.closeTarget',{targetId:other.targetId});
 await until(()=>evaluate('window.messages.some(m=>m.type==="ready")'));
 async function key(key,code,vk,down){await command('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code,windowsVirtualKeyCode:vk});}
 async function capture(path){const {data}=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path,Buffer.from(data,'base64'));}
 await sleep(6000);
 const racing=await sample('racing'),away=await send('Target.createTarget',{url:'about:blank'});await send('Target.activateTarget',{targetId:away.targetId});
 await until(()=>evaluate('document.hidden'),10000);await sleep(Number(process.env.NFS5_BACKGROUND_MS??65000));const backgroundRace=await sample('background-race');assert(backgroundRace.frames>racing.frames+30,'A hidden race continues simulating and presenting');assert(backgroundRace.stats.canvasFrames<=racing.stats.canvasFrames+2,'Hidden frames must not depend on the compositor surface');
 await send('Target.activateTarget',{targetId});await send('Target.closeTarget',{targetId:away.targetId});
 await key('ArrowUp','ArrowUp',38,true);await sleep(2000);await key('ArrowUp','ArrowUp',38,false);
 await capture('build/race-before-pause.png');
 await key('Escape','Escape',27,true);await key('Escape','Escape',27,false);await sleep(1200);
 await capture('build/race-after-pause.png');
 const pausePixel=JSON.parse(execFileSync('python3',['-c',"from PIL import Image; import json; print(json.dumps(Image.open('build/race-after-pause.png').convert('RGB').getpixel((550,310))))"]).toString());
 assert(pausePixel[0]>120&&pausePixel[1]<60&&pausePixel[2]<60,'A quick Escape opens the original red Continue button');
 const paused=await sample('paused');assert(paused.stats.peakPendingFrames<=2);assert.equal(paused.memory,384*1024*1024,'A real race fits the reduced initial Wasm allocation');
 await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:640,y:305});await sleep(100);
 await command('Input.dispatchMouseEvent',{type:'mousePressed',x:640,y:305,button:'left',buttons:1,clickCount:1});await sleep(120);
 await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:640,y:305,button:'left',buttons:0,clickCount:1});await sleep(1000);await capture('build/race-resumed.png');
 const resumed=await sample('resumed');await evaluate('window.worker.postMessage({type:"stop"})');await until(()=>evaluate('window.messages.some(m=>m.type==="stopped")'),15000);
 const result=await evaluate('window.messages.find(m=>m.type==="result").result');assert.equal(result.stopped,true);
 const errors=await evaluate('window.messages.filter(m=>m.type==="error")');assert.deepEqual(errors,[]);
 await writeFile('build/race-usability.json',JSON.stringify({before,hidden,racing,backgroundRace,paused,resumed,errors},null,2)+'\n');
 console.log(`Hidden-tab frames advanced ${hidden.frames-before.frames}; race memory ${paused.memory/1024/1024} MiB; queue peak ${paused.stats.peakPendingFrames}. Pause/resume screenshots captured.`);
} finally{socket?.close();child.kill('SIGTERM');}
