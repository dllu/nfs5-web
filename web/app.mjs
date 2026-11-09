import { attachInput } from './input.mjs';
import { openAudio } from './audio.mjs';

const hex = value => (value >>> 0).toString(16).padStart(8, '0');

const status = document.querySelector('#status');
const output = document.querySelector('#output');
const button = document.querySelector('#boot');
const playButton=document.querySelector('#play'),stopButton=document.querySelector('#stop');
const write = text => { output.textContent += text + '\n'; };
let activeWorker;
stopButton.addEventListener('click',()=>{stopButton.disabled=true;status.textContent='Stopping…';activeWorker?.postMessage({type:'stop'});});

async function start(milliseconds) {
  button.disabled=playButton.disabled=true;stopButton.hidden=false;stopButton.disabled=true;
  document.querySelector('#viewport-style').media='all';
  output.textContent = '';
  status.textContent = 'Loading translated engine…';
  delete window.nfs5Result;
  let worker;
  let detachInput;
  let audio;
  let canvas;
  let screenSize;
  try {
    if (!crossOriginIsolated) throw new Error('This build requires cross-origin isolation. Use npm run serve or serve dist with its _headers configuration.');
    audio = await openAudio();
    const previous=document.querySelector('#game');canvas=document.createElement('canvas');
    canvas.id='game';canvas.width=640;canvas.height=480;canvas.hidden=true;canvas.setAttribute('aria-label','Game output');previous.replaceWith(canvas);
    worker = new Worker(new URL('./runner.mjs', import.meta.url), { type: 'module' });
    activeWorker=worker;
    const result = await new Promise((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessage = ({ data }) => {
        if (data.type === 'log') write(data.text);
        if (data.type === 'error') reject(new Error(data.error));
        if (data.type === 'loaded') {
          const m = data.manifest;
          write(`${m.executable} · SHA-256 ${m.sha256}`);
          write(`${m.functions.toLocaleString()} translated functions · ${m.instructions.toLocaleString()} decoded instructions`);
          write(`${m.imports.length} Windows imports · entry 0x${hex(m.entry)}\n`);
          status.textContent = milliseconds?'Executing original startup code…':'Original game is running.';stopButton.disabled=false;
          detachInput = attachInput(window, event => {
            if(screenSize&&!canvas.hidden){
              const rect=canvas.getBoundingClientRect();
              if('x' in event){event.x=Math.round((event.x-rect.left)*screenSize.width/rect.width);event.y=Math.round((event.y-rect.top)*screenSize.height/rect.height);}
              if('dx' in event){event.dx=Math.round(event.dx*screenSize.width/rect.width);event.dy=Math.round(event.dy*screenSize.height/rect.height);}
            }
            worker.postMessage(event);
          });
        }
        if(data.type==='screen'){
          screenSize=data;canvas.hidden=false;canvas.style.setProperty('--game-aspect',data.width/data.height);
          document.body.classList.add('playing');
        }
        if (data.type === 'result') {
          if(data.frame){
            const still=document.createElement('canvas');still.id='game';still.width=data.frame.width;still.height=data.frame.height;still.setAttribute('aria-label','Game output');
            still.getContext('2d').drawImage(data.frame,0,0);data.frame.close();canvas.replaceWith(still);canvas=still;
          }
          resolve(data.result);
        }
      };
      const offscreen=canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'start', milliseconds, audio: audio.configuration,
        display: { width: Math.round(innerWidth * devicePixelRatio), height: Math.round(innerHeight * devicePixelRatio) },
        canvas:offscreen },[offscreen]);
    });
    window.nfs5Result = result;
    status.textContent = result.stopped?'Stopped.':result.exited?`Game exited (code ${result.exitCode}).`:result.status ? (/budget reached/i.test(result.error)?'Diagnostic execution limit reached':'Execution stopped at a porting dependency') : 'Startup function returned';
    write(result.error || (result.exited?`Game exited with code ${result.exitCode}`:'Returned successfully'));
    write(`\n${result.count.toLocaleString()} function entries. Recent calls:`);
    write(result.trace.slice(-32).map(pc => '0x' + hex(pc)).join(' → '));
    write('\n' + ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI']
      .map((name, index) => `${name} 0x${hex(result.registers[index])}`).join('  '));
  } catch (error) {
    status.textContent = 'Unable to start the runtime';
    write(error.stack || String(error));
  } finally {
    document.body.classList.remove('playing');
    document.querySelector('#viewport-style').media='not all';
    detachInput?.();
    worker?.terminate();
    await audio?.close();
    activeWorker=null;stopButton.hidden=true;button.disabled=playButton.disabled=false;
  }
}
button.addEventListener('click',()=>start(5000));
playButton.addEventListener('click',()=>start(0));
