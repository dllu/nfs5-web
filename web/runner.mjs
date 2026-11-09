import { loadRuntime } from './runtime.mjs';

let runtime;
self.onmessage = async ({ data }) => {
  if (data.type === 'input') { runtime?.input(data); return; }
  if(data.type==='checkpoint'){await runtime?.checkpoint().catch(error=>self.postMessage({type:'save-error',error:String(error)}));return;}
  if (data.type === 'stop') { runtime?.stop();return; }
  if (data.type !== 'start' || runtime) return;
  try {
    runtime = await loadRuntime({ log: text => self.postMessage({ type: 'log', text }), audio: data.audio, display: data.display,
      intro:data.intro,softwarePixelLimit:data.softwarePixelLimit,canvas:data.canvas,onResize:(width,height)=>self.postMessage({type:'screen',width,height}) });
    self.postMessage({ type: 'loaded', manifest: runtime.manifest, graphics:runtime.graphics?.renderer.info,
      display:runtime.display,reducedResolution:runtime.reducedResolution });
    const result = await runtime.runAsync(data.milliseconds??0);
    // Keep the diagnostic's final frame visible after releasing its GPU device.
    let frame;
    if(runtime.graphics){runtime.graphics.renderer.present();frame=data.canvas.transferToImageBitmap();}
    self.postMessage({ type: 'result', frame, result: { ...result, winMainEntered: runtime.seen(0x004b6710), workerEntered: runtime.seen(0x0055f4f0) } },frame?[frame]:[]);
  } catch (error) {
    self.postMessage({ type: 'error', error: error.stack || String(error) });
  } finally {
    runtime?.dispose();
  }
};
