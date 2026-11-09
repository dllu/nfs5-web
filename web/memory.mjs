// Shared Wasm memory can grow in a pthread while the JS host is awaiting GPU
// work. Existing SharedArrayBuffer views remain valid, but keep their old size.
// Emscripten refreshes its internal views on access; keep its exported byte view
// current too, including direct reads by graphics, audio and save checkpoints.
export function trackHeap(module) {
  let heap=module.HEAPU8;
  Object.defineProperty(module,'HEAPU8',{
    configurable:true,
    get(){
      const buffer=module.wasmMemory.buffer;
      if(heap.buffer!==buffer)heap=new Uint8Array(buffer);
      return heap;
    },
    set(view){heap=view;},
  });
  return module;
}
