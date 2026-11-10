import { loadRuntime } from './runtime.mjs';

let runtime,visible=true,focused=true;
self.onmessage = async ({ data }) => {
  if(data.type==='visibility'){visible=data.visible;runtime?.graphics?.setVisible(visible);return;}
  if(data.type==='focus'){focused=data.focused;runtime?.graphics?.setFocused(focused);return;}
  if(data.type==='viewport'){runtime?.graphics?.setFrontendSize(data.display);return;}
  if(data.type==='detail'){runtime?.setDetail(data.value);return;}
  if(data.type==='diagnostics'){
    const r=runtime?.graphics?.renderer;
    const m=runtime?.module,values=m&&Array.from(new Float64Array(m.HEAPU8.buffer,m._web_fs_io_stats(),6));
    const files=values&&Object.fromEntries(['rangeRequests','rangeBytes','rangeWaitMs','maxRangeWaitMs','preloadedReads','preloadedBytes'].map((key,i)=>[key,values[i]]));
    const queue=m&&Array.from(new Uint32Array(m.HEAPU8.buffer,m._web_gpu_stats(),7));
    self.postMessage({type:'diagnostics',info:r?.info,logical:r&&[r.width,r.height],output:r&&[r.outputWidth,r.outputHeight],wasmBytes:m?.HEAPU8.byteLength,stats:r?.stats,transport:{...runtime?.graphics?.stats,producerPackets:queue?.[5],producerNotifications:queue?.[6]},submissionIntervalsMs:r?.timing(),loading:runtime?.loading,detail:runtime?.detailStats(),files,fileActivity:runtime?.fileActivity(),pacing:runtime?.graphics?.pacing,streaming:runtime?.streamingStats(),audio:runtime?.audioStats(),capabilities:{waitAsync:typeof Atomics.waitAsync==='function',schedulerYield:typeof scheduler!=='undefined'&&!!scheduler.yield}});return;
  }
  if (data.type === 'input') { runtime?.input(data); return; }
  if(data.type==='checkpoint'){await runtime?.checkpoint().catch(error=>self.postMessage({type:'save-error',error:String(error)}));return;}
  if (data.type === 'stop') { runtime?.stop();return; }
  if (data.type !== 'start' || runtime) return;
  try {
    runtime = await loadRuntime({ log: text => self.postMessage({ type: 'log', text }), audio: data.audio, display: data.display,
      intro:data.intro,detail:data.detail,softwarePixelLimit:data.softwarePixelLimit,touchPixelLimit:data.touchPixelLimit,canvas:data.canvas,onResize:(width,height)=>self.postMessage({type:'screen',width,height}) });
    runtime.graphics?.setVisible(visible);
    runtime.graphics?.setFocused(focused);
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
