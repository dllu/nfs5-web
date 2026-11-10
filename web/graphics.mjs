import { createRenderer, mipLayout } from './renderer.mjs';
import {framePacer} from './pacing.mjs';

const stateFields = ['texture','depth_test','depth_write','blend_enable','src_blend','dst_blend','filter_linear','address_wrap','cull',
  'alpha_test','alpha_ref','fog_enable','fog_color','fog_near','fog_far','primitive','depth_func',
  'scissor_enable','scissor_x','scissor_y','scissor_w','scissor_h','alpha_modulate','fog_mode','fog_density','shade_mode',
  'mip_filter','address_u','address_v','mip_lod_bias','alpha_func',
  'stencil_enable','stencil_func','stencil_fail','stencil_depth_fail','stencil_pass',
  'stencil_ref','stencil_read_mask','stencil_write_mask','color_write','gamma'];

export function decodeGraphicsState(words) {
  const state={},floats=new Float32Array(words.buffer,words.byteOffset,words.length);
  for(let i=0;i<words.length;i++)state[stateFields[i]]=[13,14,24,29,40].includes(i)?floats[i]:words[i];
  return state;
}

export async function attachGraphics(module, canvas, { onResize = () => {}, pace = true, frontendSize } = {}) {
  let closed=false, pumping=null, failure=null, stateCache=null, stateWords=null, serial=0;
  const states=new Map(),stateOrder=new Array(4096);let stateCursor=0;
  const visibilitySamples=new Map();
  let visible=true,focused=true;
  const pacing=framePacer();
  let channel,yieldResolve;
  const stats={packets:0,copiedBytes:0,stateHits:0,stateMisses:0,stateEvictions:0,visibilityQueries:0,visibilityReuses:0};
  const pointer=module._web_gpu_transport(), uploads=new Map();
  let header,ring,stateSize,roomWaiters=false;
  function views() {
    if(header?.buffer===module.HEAPU8.buffer)return;
    header=new Int32Array(module.HEAPU8.buffer,pointer,8);
    const version=Atomics.load(header,6);
    if(![1,2,3,4,5,6,7,8,9,10].includes(version))throw new Error('Unsupported graphics transport version');
    roomWaiters=version>=10;
    stateSize=version>=7?41:version>=6?40:version>=5?31:version>=4?30:version>=3?26:25;
    const size=Atomics.load(header,5)>>>0;
    if(!size || (size&(size-1)))throw new Error('Invalid graphics queue size');
    ring=new Uint32Array(module.HEAPU8.buffer,pointer+32,size);
  }
  views();
  function fail(error) {
    if(closed || failure)return;
    failure=error instanceof Error?error:new Error(String(error));
    const bytes=new TextEncoder().encode(failure.message+'\0'),p=module._malloc(bytes.length);
    try{module.HEAPU8.set(bytes,p);module._web_gpu_fail(p);}finally{module._free(p);}
    Atomics.notify(header,0);
  }
  const renderer=await createRenderer(canvas,{onError:fail,frontendSize});
  function packetView(start,count) {
    const at=start%ring.length,first=Math.min(count,ring.length-at);
    if(first===count)return ring.subarray(at,at+count);
    stats.copiedBytes+=count*4;
    const result=new Uint32Array(count);
    result.set(ring.subarray(at,at+first));if(first<count)result.set(ring.subarray(0,count-first),first);return result;
  }
  function state(data) {
    if(!stateWords || stateWords.some((v,i)=>v!==data[i])) {
      let hash=2166136261;
      for(let i=0;i<stateSize;i++)hash=Math.imul(hash^data[i],16777619);
      const bucket=states.get(hash),entry=bucket?.find(e=>e.words.every((v,i)=>v===data[i]));
      if(entry){stateWords=entry.words;stateCache=entry.state;stats.stateHits++;}
      else {
        // Evict one old entry at a time. Clearing thousands of states together
        // would rebuild the entire working set and create a garbage burst.
        const old=stateOrder[stateCursor];
        if(old){
          const entries=states.get(old.hash);entries.splice(entries.indexOf(old),1);
          if(!entries.length)states.delete(old.hash);stats.stateEvictions++;
        }
        stateWords=data.slice(0,stateSize);stateCache={...decodeGraphicsState(stateWords),serial:++serial};
        const entry={hash,words:stateWords,state:stateCache};
        if(states.has(hash))states.get(hash).push(entry);else states.set(hash,[entry]);
        stateOrder[stateCursor]=entry;stateCursor=(stateCursor+1)%stateOrder.length;stats.stateMisses++;
      }
    } else stats.stateHits++;
    return stateCache;
  }
  async function visibilityPixels(rect,key) {
    // Keep owned pixels, never a guest destination whose allocation ends at
    // acknowledgement. One pending sample per cached sun bounds GPU work.
    let entry=visibilitySamples.get(key);
    if(!entry||entry.width!==rect.width||entry.height!==rect.height){
      if(visibilitySamples.size>=8)visibilitySamples.delete(visibilitySamples.keys().next().value);
      entry={width:rect.width,height:rect.height,pixels:null,pending:null};visibilitySamples.set(key,entry);
    }
    if(!entry.pending){
      stats.visibilityQueries++;
      entry.pending=renderer.readPixels(rect).then(pixels=>{entry.pixels=pixels;entry.pending=null;},error=>{entry.pending=null;fail(error);});
    }
    if(!entry.pixels){await entry.pending;if(failure)throw failure;}
    else stats.visibilityReuses++;
    return entry.pixels;
  }
  async function drain() {
    if(closed || failure)return;
    const until=performance.now()+8;
    while(!closed && !failure) {
      views();const read=Atomics.load(header,1)>>>0,write=Atomics.load(header,0)>>>0;
      if(read===write)return;
      const count=ring[read%ring.length];
      if(count<3 || count>=ring.length || count>((write-read)>>>0))throw new Error('Corrupt graphics command');
      // Keep the span reserved while its views are consumed. Contiguous packets
      // need no allocation; only a packet crossing the ring boundary is copied.
      stats.packets++;
      const packet=packetView(read,count),opcode=packet[1],sequence=packet[2],data=packet.subarray(3);
      switch(opcode) {
        case 1:visibilitySamples.clear();pacing.setState({menu:data[0]===640&&data[1]===480});renderer.resize(data[0],data[1]);onResize(data[0],data[1]);break;
        case 2:{
          const options=data.length===2?undefined:{mask:data[2],stencil:data[3],rect:{x:data[4],y:data[5],width:data[6],height:data[7]}};
          if(data.length!==2&&data.length!==8)throw new Error('Invalid clear packet length');
          renderer.clear(data[0],new Float32Array(data.buffer,data.byteOffset,data.length)[1],options);break;
        }
        case 3:
          if(pace)await pacing.next();
          if(closed)return;renderer.present(visible,focused);await renderer.frameBudget();break;
        case 4:{
          const vertices=data[stateSize],indices=data[stateSize+1],vertexStart=stateSize+2,vertexEnd=vertexStart+vertices*8;
          if(data.length!==vertexEnd+indices)throw new Error('Invalid draw packet length');
          renderer.draw(new Uint8Array(data.buffer,data.byteOffset+vertexStart*4,vertices*32),indices?data.subarray(vertexEnd):null,state(data));break;
        }
        case 5:{
          const levels=data[3]??1,size=mipLayout(data[1],data[2],levels).size;
          renderer.textureCreate(data[0],data[1],data[2],null,levels);uploads.set(data[0],{size,next:0,bytes:null});break;
        }
        case 6:{
          const [id,offset,length,total]=data,entry=uploads.get(id);
          if(!entry || total!==entry.size || offset!==entry.next || length>total-offset || data.length*4!==length+16)throw new Error('Invalid texture upload');
          entry.bytes??=new Uint8Array(total);entry.bytes.set(new Uint8Array(data.buffer,data.byteOffset+16,length),offset);entry.next+=length;
          if(entry.next===total){renderer.textureUpdate(id,entry.bytes);entry.bytes=null;entry.next=0;}break;
        }
        case 7:renderer.textureDestroy(data[0]);uploads.delete(data[0]);break;
        case 8:{
          const [destination,width,height,x=0,y=0,hint=0,key=0]=data;
          if(![3,5,7].includes(data.length)||!width||!height||hint>1||(hint&&(width>4||height>4))||x+width>renderer.width||y+height>renderer.height||destination+width*height*4>module.HEAPU8.length)
            throw new Error(`Invalid graphics readback: ${width}x${height} at ${x},${y}, framebuffer ${renderer.width}x${renderer.height}, destination ${destination}, heap ${module.HEAPU8.length}, packet ${data.length}`);
          const rect={x,y,width,height},pixels=hint?await visibilityPixels(rect,key):await renderer.readPixels(rect);if(closed)return;
          module.HEAPU8.set(pixels,destination);break;
        }
        // Flush is a submission hint, not a completion barrier. Keep geometry
        // together, but submit large batches early to overlap GPU work with
        // native scene preparation. Reads and mutations flush in order too.
        case 9:renderer.flushHint();break;
        case 10:renderer.reset();uploads.clear();states.clear();stateOrder.fill(null);stateCursor=0;stateWords=stateCache=null;visibilitySamples.clear();break;
        default:throw new Error(`Unsupported graphics command ${opcode}`);
      }
      views();
      Atomics.store(header,1,(read+count)|0);
      if(!roomWaiters||Atomics.load(header,7))Atomics.notify(header,1);
      Atomics.store(header,2,sequence|0);
      if(opcode===1||opcode===3||opcode>=8)Atomics.notify(header,2);
      if(performance.now()>until)return;
    }
  }
  function pump() {
    if(pumping || closed || failure)return pumping;
    pumping=drain().catch(fail).finally(()=>{pumping=null;});return pumping;
  }
  function yieldTask() {
    if(globalThis.scheduler?.yield)return globalThis.scheduler.yield();
    channel??=new MessageChannel();
    return new Promise(resolve=>{
      yieldResolve=resolve;channel.port1.onmessage=()=>{yieldResolve=null;resolve();};channel.port2.postMessage(0);
    });
  }
  async function consume() {
    while(!closed&&!failure) {
      await pump();if(closed||failure)return;
      views();const write=Atomics.load(header,0);
      if((Atomics.load(header,1)|0)!==write){await yieldTask();continue;}
      // Native producers notify after publishing a complete packet. Check and
      // wait on the same value to avoid losing a write between these steps.
      const wait=Atomics.waitAsync(header,0,write);
      if(wait.async)await wait.value;
    }
  }
  module._web_gpu_attach();
  // Browser interval timers are clamped to about 4 ms. Wake on queue writes
  // without polling; retain the interval path for older JS engines.
  const timer=typeof Atomics.waitAsync==='function'&&Atomics.load(header,6)>=2?null:setInterval(pump,1);
  if(timer===null)consume().catch(fail);
  return {
    renderer,stats,pacing:pacing.stats,
    setVisible(value){visible=Boolean(value);renderer.resetTiming();pacing.setState({visible});},
    setFocused(value){focused=Boolean(value);renderer.resetTiming();pacing.setState({focused});},
    setFrontendSize(size){if(!frontendSize)return;Object.assign(frontendSize,size);renderer.resize(renderer.width,renderer.height);onResize(renderer.width,renderer.height);},
    async settle() {
      while(!closed && !failure) {
        await pump();views();if((Atomics.load(header,0)>>>0)===(Atomics.load(header,1)>>>0))break;
      }
      if(failure)throw failure;await renderer.validate();
    },
    close() {
      if(closed)return;fail(new Error('Renderer detached'));closed=true;
      if(timer!==null)clearInterval(timer);Atomics.notify(header,0);yieldResolve?.();pacing.close();
      channel?.port1.close();channel?.port2.close();renderer.close();
    },
  };
}
