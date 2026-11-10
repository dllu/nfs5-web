import {streamAssets} from './streaming.mjs';
self.onmessage=({data})=>{
  try{
    const run=streamAssets(data);self.postMessage({ready:true});
    run.catch(error=>{Atomics.store(new Int32Array(data.buffer,data.offset,16),0,0);self.postMessage({error:String(error)});});
  }catch(error){self.postMessage({error:String(error)});}
};
