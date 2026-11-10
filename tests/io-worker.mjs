import {loadRuntime} from './runtime.mjs';
let runtime,handle,phase;
const address=0x800000,chunk=262144;
self.onmessage=async({data})=>{
 try{
  if(data.type==='probe'){
   const started=performance.now();runtime.module._web_input_stats();
   if(data.mutate)runtime.mount('C:\\nfs5\\Slow.bin',{url:data.replacement,size:chunk});
   postMessage({type:'probe',phase,ms:performance.now()-started,reading:runtime.module._web_async_status()===1});return;
  }
  if(data.type!=='start')return;
  runtime=await loadRuntime({persist:false});const m=runtime.module;
  const call=async(name,args)=>{
   const r=await runtime.invokeAsync(runtime.manifest.imports.find(e=>e.name===name).slot,args);if(r.status)throw new Error(r.error);return r.registers[0];
  };
  const put=s=>m.HEAPU8.set(new TextEncoder().encode(s+'\0'),runtime.base+address);
  for(phase=1;phase<=2;phase++){
   runtime.mount('C:\\nfs5\\Slow.bin',{url:data.url+'?phase='+phase,size:chunk});put('C:\\nfs5\\Slow.bin');
   handle=await call('CreateFileA',[address,0x80000000,3,0,3,128,0]);
   m.HEAPU8.fill(211,runtime.base+address+256,runtime.base+address+288);
   const result=await call('ReadFile',[handle,address+256,32,address+128,0]);
   const bytes=Array.from(m.HEAPU8.subarray(runtime.base+address+256,runtime.base+address+288));
   postMessage({type:'read',phase,result,bytes,events:runtime.fileActivity()});
   await call('CloseHandle',[handle]);
  }
  runtime.dispose();postMessage({type:'done'});
 }catch(error){runtime?.dispose();postMessage({type:'error',error:error.stack||String(error)});}
};
