// A few future music ranges, never the entire archive or a writable save.
export async function attachStream(module,assets,ids,log=()=>{}) {
  const entry=assets?.index.entries.find(e=>e.path.toLowerCase()==='gamedata/music/zzzymus.viv');
  if(!entry||typeof Worker==='undefined'||!Worker.prototype.addEventListener||!module._web_fs_stream)return {close(){},stats:()=>null};
  const offset=module._web_fs_stream(ids.get(entry.path));
  if(!offset)return {close(){},stats:()=>null};
  let worker;
  const close=()=>{if(worker){worker.onmessage=worker.onerror=null;worker.terminate();}module._web_fs_stream(0);};
  try{
    worker=new Worker(new URL('./stream-worker.mjs',import.meta.url),{type:'module'});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Read-ahead worker startup timed out')),5000);
      worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(new Error(data.error)):resolve();};
      worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message));};
      worker.postMessage({buffer:module.HEAPU8.buffer,offset,url:new URL(entry.url,import.meta.url).href});
    });
    const unavailable=()=>{close();log('Music read-ahead unavailable; using ordinary range reads');};
    worker.onerror=unavailable;worker.onmessage=({data})=>{if(data.error)unavailable();};
    return {close,stats:()=>{
      const s=new Int32Array(module.HEAPU8.buffer,offset,16);
      return {enabled:!!Atomics.load(s,0),hits:Atomics.load(s,5)>>>0,requests:Atomics.load(s,6)>>>0,bytes:Atomics.load(s,7)>>>0,failures:Atomics.load(s,8)>>>0,misses:Atomics.load(s,12)>>>0};
    }};
  }catch(error){close();log(`Music read-ahead unavailable: ${error.message}`);return {close(){},stats:()=>null};}
}

export async function streamAssets({buffer,offset,url},{read=fetch}={}) {
  const header=new Int32Array(buffer,offset,16),size=header[3]>>>0,chunk=header[10]>>>0,count=header[11]>>>0;
  if(header[9]!==1||chunk!==262144||count!==4)throw new Error('Unsupported read-ahead layout');
  const pages=Array.from({length:count},(_,i)=>{
    const at=offset+64+i*(chunk+16);
    return {state:new Int32Array(buffer,at,4),data:new Uint8Array(buffer,at+16,chunk)};
  });
  const jobs=new Map();let desired=new Set();
  const wake=()=>{Atomics.add(header,1,1);Atomics.notify(header,1);};
  async function fill(page,start,controller){
    let ready=false;
    try{
      Atomics.add(header,6,1);
      const length=Math.min(chunk,size-start),response=await read(url,{headers:{Range:`bytes=${start}-${start+length-1}`},signal:controller.signal});
      const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')??'');
      if(response.status!==206||!range||Number(range[1])!==start||Number(range[2])!==start+length-1||Number(range[3])!==size){response.body?.cancel().catch(()=>{});throw new Error('Invalid read-ahead range response');}
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length!==length)throw new Error('Truncated read-ahead range');
      if(controller.signal.aborted||!Atomics.load(header,0)||!desired.has(start))return;
      page.data.set(bytes);page.state[1]=start;page.state[2]=length;
      Atomics.add(header,7,length);Atomics.store(page.state,0,2);ready=true;
    }catch(error){
      if(!controller.signal.aborted){Atomics.add(header,8,1);Atomics.store(header,0,0);}
    }finally{if(!ready)Atomics.store(page.state,0,0);jobs.delete(start);wake();}
  }
  try{
    while(Atomics.load(header,0)){
      const start=Atomics.load(header,4)>>>0;
      desired=new Set();
      if(start!==0xffffffff)for(let i=1;i<count;i++)if(start+i*chunk<size)desired.add(start+i*chunk);
      for(const [at,job]of jobs)if(!desired.has(at))job.controller.abort();
      for(const at of desired){
        if(jobs.size>=2)break;
        if(jobs.has(at)||pages.some(p=>Atomics.load(p.state,0)===2&&(p.state[1]>>>0)===at))continue;
        const page=pages.find(p=>{
          if(Atomics.compareExchange(p.state,0,0,1)===0)return true;
          if(Atomics.load(p.state,0)===2&&!desired.has(p.state[1]>>>0))return Atomics.compareExchange(p.state,0,2,1)===2;
          return false;
        });
        if(!page)break;
        const controller=new AbortController(),job={controller};jobs.set(at,job);job.done=fill(page,at,controller);
      }
      const epoch=Atomics.load(header,1);
      // Recheck the hint after capturing the epoch: no lost publication when
      // native code advances a page between selecting work and parking.
      if((Atomics.load(header,4)>>>0)!==start)continue;
      if(typeof Atomics.waitAsync==='function'){
        const wait=Atomics.waitAsync(header,1,epoch);if(wait.async)await wait.value;
      }else await new Promise(resolve=>setTimeout(resolve,4));
    }
  }finally{for(const job of jobs.values())job.controller.abort();await Promise.allSettled([...jobs.values()].map(j=>j.done));}
}
