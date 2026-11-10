// Start network work while the much larger Wasm module is compiling.
export async function readAssets(read,log=()=>{}) {
  let response;
  try{response=await read('./assets.json');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`Unable to load assets: HTTP ${response.status}`);
  const index=await response.json();
  const pack=index.preload?read(index.preload.url).then(async response=>{
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==index.preload.size||bytes.length>16*1024*1024)throw new Error('Invalid startup pack size');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==index.preload.sha256)throw new Error('Invalid startup pack hash');
    return bytes;
  }).catch(error=>{log(`Startup preload unavailable: ${error.message}`);return null;}):null;
  return {index,pack};
}

export async function preloadAssets(module,assets,ids) {
  const bytes=await assets?.pack;
  if(!bytes||!module._web_fs_preload)return {bytes:0,files:0,release(){}};
  const entries=assets.index.entries.filter(e=>e.preloadOffset!==undefined);
  for(const e of entries)if(!Number.isInteger(e.preloadOffset)||e.preloadOffset<0||e.preloadOffset+e.size>bytes.length)throw new Error('Invalid startup pack entry');
  const pointer=module._malloc(bytes.length);if(!pointer)throw new Error('Unable to allocate startup pack');
  const loaded=[];
  const release=()=>{for(const id of loaded)module._web_fs_preload(id,0,0);module._free(pointer);};
  try{
    module.HEAPU8.set(bytes,pointer);
    for(const e of entries){const id=ids.get(e.path);if(!module._web_fs_preload(id,pointer+e.preloadOffset,e.size))throw new Error(`Unable to preload ${e.path}`);loaded.push(id);}
    return {bytes:bytes.length,files:loaded.length,release};
  }catch(error){release();throw error;}
}
