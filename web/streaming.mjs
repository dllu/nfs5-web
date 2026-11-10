// Keep complete current/next songs in a bounded cache, never the whole archive.
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
      worker.postMessage({buffer:module.HEAPU8.buffer,offset,url:new URL(entry.url,import.meta.url).href,ranges:assets.index.music?.path===entry.path?assets.index.music.tracks:undefined});
    });
    const unavailable=()=>{close();log('Music read-ahead unavailable; using ordinary range reads');};
    worker.onerror=unavailable;worker.onmessage=({data})=>{if(data.error)unavailable();};
    return {close,stats:()=>{
      const s=new Int32Array(module.HEAPU8.buffer,offset,16);
      return {enabled:!!Atomics.load(s,0),hits:Atomics.load(s,5)>>>0,requests:Atomics.load(s,6)>>>0,bytes:Atomics.load(s,7)>>>0,failures:Atomics.load(s,8)>>>0,misses:Atomics.load(s,12)>>>0,cacheBytes:s[10]*s[11]};
    }};
  }catch(error){close();log(`Music read-ahead unavailable: ${error.message}`);return {close(){},stats:()=>null};}
}

export async function streamAssets({buffer,offset,url,ranges=[]},{read=fetch}={}) {
  const header=new Int32Array(buffer,offset,16),size=header[3]>>>0,chunk=header[10]>>>0,count=header[11]>>>0;
  if(!([1,2].includes(header[9]))||chunk!==262144||count!==(header[9]===1?4:48))throw new Error('Unsupported read-ahead layout');
  if(!Array.isArray(ranges)||ranges.length>128||ranges.some(r=>!Number.isInteger(r.offset)||!Number.isInteger(r.size)||r.offset<0||r.size<1||r.offset+r.size>size))throw new Error('Invalid music ranges');
  const pages=Array.from({length:count},(_,i)=>{
    const at=offset+64+i*(chunk+16);
    return {state:new Int32Array(buffer,at,4),data:new Uint8Array(buffer,at+16,chunk)};
  });
  const jobs=new Map();let desired=new Set();
  const wake=()=>{Atomics.add(header,1,1);Atomics.notify(header,1);};
  async function fill(batch,start,controller){
    const ready=new Set();
    try{
      Atomics.add(header,6,1);
      const length=Math.min(chunk*batch.length,size-start),response=await read(url,{headers:{Range:`bytes=${start}-${start+length-1}`},signal:controller.signal});
      const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')??'');
      if(response.status!==206||!range||Number(range[1])!==start||Number(range[2])!==start+length-1||Number(range[3])!==size){response.body?.cancel().catch(()=>{});throw new Error('Invalid read-ahead range response');}
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length!==length)throw new Error('Truncated read-ahead range');
      if(controller.signal.aborted||!Atomics.load(header,0))return;
      for(const [i,page]of batch.entries()){
        const at=start+i*chunk,n=Math.min(chunk,size-at);if(!desired.has(at))continue;
        page.data.set(bytes.subarray(i*chunk,i*chunk+n));page.state[1]=at;page.state[2]=n;
        Atomics.add(header,7,n);Atomics.store(page.state,0,2);ready.add(page);
      }
    }catch(error){
      if(!controller.signal.aborted){Atomics.add(header,8,1);Atomics.store(header,0,0);}
    }finally{for(const page of batch)if(!ready.has(page))Atomics.store(page.state,0,0);jobs.delete(start);wake();}
  }
  try{
    while(Atomics.load(header,0)){
      const hint=Atomics.load(header,4)>>>0,start=Math.floor(hint/chunk)*chunk;
      desired=new Set();
      const song=hint===0xffffffff?-1:ranges.findIndex(r=>hint>=r.offset&&hint<r.offset+r.size);
      if(song>=0){
        // Current song first, then its directory successor. Keep every page of
        // the current song, including past pages needed by loops/backward seeks.
        for(const index of [song,(song+1)%ranges.length]){
          const r=ranges[index];for(let at=Math.floor(r.offset/chunk)*chunk;at<r.offset+r.size;at+=chunk)desired.add(at);
        }
        while(desired.size>count)desired.delete([...desired].at(-1));
      }else if(hint!==0xffffffff)for(let i=1;i<4;i++)if(start+i*chunk<size)desired.add(start+i*chunk);
      for(const [at,job]of jobs)if(!job.pages.some((_,i)=>desired.has(at+i*chunk)))job.controller.abort();
      const queued=at=>[...jobs].some(([start,job])=>at>=start&&at<start+job.pages.length*chunk);
      const available=at=>pages.some(p=>Atomics.load(p.state,0)===2&&(p.state[1]>>>0)===at);
      const claim=()=>pages.find(p=>{
        if(Atomics.compareExchange(p.state,0,0,1)===0)return true;
        if(Atomics.load(p.state,0)===2&&!desired.has(p.state[1]>>>0))return Atomics.compareExchange(p.state,0,2,1)===2;
        return false;
      });
      for(const at of desired){
        if(jobs.size>=2)break;
        if(queued(at)||available(at))continue;
        const page=claim();
        if(!page)break;
        const batch=[page];
        if(header[9]>=2)while(batch.length<4){
          const next=at+batch.length*chunk;if(!desired.has(next)||queued(next)||available(next))break;
          const page=claim();if(!page)break;batch.push(page);
        }
        const controller=new AbortController(),job={controller,pages:batch};jobs.set(at,job);job.done=fill(batch,at,controller);
      }
      const epoch=Atomics.load(header,1);
      // Recheck the hint after capturing the epoch: no lost publication when
      // native code advances a page between selecting work and parking.
      if((Atomics.load(header,4)>>>0)!==hint)continue;
      if(typeof Atomics.waitAsync==='function'){
        const wait=Atomics.waitAsync(header,1,epoch);if(wait.async)await wait.value;
      }else await new Promise(resolve=>setTimeout(resolve,4));
    }
  }finally{for(const job of jobs.values())job.controller.abort();await Promise.allSettled([...jobs.values()].map(j=>j.done));}
}
