import { createRenderer } from './renderer.mjs';

const stateFields = ['texture','depth_test','depth_write','blend_enable','src_blend','dst_blend','filter_linear','address_wrap','cull',
  'alpha_test','alpha_ref','fog_enable','fog_color','fog_near','fog_far','primitive','depth_func',
  'scissor_enable','scissor_x','scissor_y','scissor_w','scissor_h','alpha_modulate','fog_mode','fog_density'];

export async function attachGraphics(module, canvas, { onResize = () => {}, pace = true } = {}) {
  let closed=false, pumping=null, failure=null, stateCache=null, stateWords=null, serial=0;
  const pointer=module._web_gpu_transport(), uploads=new Map();
  let header,ring;
  function views() {
    if(header?.buffer===module.HEAPU8.buffer)return;
    header=new Int32Array(module.HEAPU8.buffer,pointer,8);
    if(Atomics.load(header,6)!==1)throw new Error('Unsupported graphics transport version');
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
  }
  const renderer=await createRenderer(canvas,{onError:fail});
  function snapshot(start,count) {
    const result=new Uint32Array(count),at=start%ring.length,first=Math.min(count,ring.length-at);
    result.set(ring.subarray(at,at+first));if(first<count)result.set(ring.subarray(0,count-first),first);return result;
  }
  function state(data) {
    if(!stateWords || stateWords.some((v,i)=>v!==data[i])) {
      stateWords=data.slice(0,25);stateCache={serial:++serial};
      const floats=new Float32Array(stateWords.buffer);
      stateFields.forEach((name,i)=>{stateCache[name]=i===13||i===14||i===24?floats[i]:stateWords[i];});
    }
    return stateCache;
  }
  async function drain() {
    if(closed || failure)return;
    const until=performance.now()+8;
    while(!closed && !failure) {
      views();const read=Atomics.load(header,1)>>>0,write=Atomics.load(header,0)>>>0;
      if(read===write)return;
      const count=ring[read%ring.length];
      if(count<3 || count>=ring.length || count>((write-read)>>>0))throw new Error('Corrupt graphics command');
      // Copy before releasing the queue span; producers may immediately reuse it.
      const packet=snapshot(read,count),opcode=packet[1],sequence=packet[2],data=packet.subarray(3);
      Atomics.store(header,1,(read+count)|0);
      switch(opcode) {
        case 1:renderer.resize(data[0],data[1]);onResize(data[0],data[1]);break;
        case 2:renderer.clear(data[0],new Float32Array(data.buffer,data.byteOffset,data.length)[1]);break;
        case 3:
          if(pace)await new Promise(resolve=>typeof requestAnimationFrame==='function'?requestAnimationFrame(resolve):setTimeout(resolve,1000/60));
          if(closed)return;renderer.present();break;
        case 4:{
          const vertices=data[25],indices=data[26],vertexEnd=27+vertices*8;
          if(data.length!==vertexEnd+indices)throw new Error('Invalid draw packet length');
          renderer.draw(new Uint8Array(data.buffer,data.byteOffset+108,vertices*32),indices?data.subarray(vertexEnd):null,state(data));break;
        }
        case 5:renderer.textureCreate(data[0],data[1],data[2]);uploads.set(data[0],{size:data[1]*data[2]*4,next:0,bytes:null});break;
        case 6:{
          const [id,offset,length,total]=data,entry=uploads.get(id);
          if(!entry || total!==entry.size || offset!==entry.next || length>total-offset || data.length*4!==length+16)throw new Error('Invalid texture upload');
          entry.bytes??=new Uint8Array(total);entry.bytes.set(new Uint8Array(data.buffer,data.byteOffset+16,length),offset);entry.next+=length;
          if(entry.next===total){renderer.textureUpdate(id,entry.bytes);entry.bytes=null;entry.next=0;}break;
        }
        case 7:renderer.textureDestroy(data[0]);uploads.delete(data[0]);break;
        case 8:{
          const [destination,width,height]=data;
          if(width!==renderer.width || height!==renderer.height || destination+width*height*4>module.HEAPU8.length)throw new Error('Invalid graphics readback');
          const pixels=await renderer.readPixels();if(closed)return;
          module.HEAPU8.set(pixels,destination);break;
        }
        case 9:renderer.flush();break;
        case 10:renderer.reset();uploads.clear();stateWords=stateCache=null;break;
        default:throw new Error(`Unsupported graphics command ${opcode}`);
      }
      views();Atomics.store(header,2,sequence|0);
      if(performance.now()>until)return;
    }
  }
  function pump() {
    if(pumping || closed || failure)return pumping;
    pumping=drain().catch(fail).finally(()=>{pumping=null;});return pumping;
  }
  module._web_gpu_attach();const timer=setInterval(pump,1);
  return {
    renderer,
    async settle() {
      while(!closed && !failure) {
        await pump();views();if((Atomics.load(header,0)>>>0)===(Atomics.load(header,1)>>>0))break;
      }
      if(failure)throw failure;await renderer.validate();
    },
    close() {
      if(closed)return;fail(new Error('Renderer detached'));closed=true;clearInterval(timer);renderer.close();
    },
  };
}
