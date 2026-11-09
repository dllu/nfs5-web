import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const r=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
assert(r.manifest.patches.includes('verok-visibility'));
const m=r.module,v=new DataView(m.HEAPU8.buffer,r.base),stack=r.memorySize-0x10000;
const word=(address,value)=>{const b=Buffer.alloc(4);b.writeUInt32LE(value>>>0);return {address,hex:b.toString('hex')};};
const float=(address,value)=>{const b=Buffer.alloc(4);b.writeFloatLE(value);return {address,hex:b.toString('hex')};};
const put=(p,x)=>v.setUint32(p,x>>>0,true),get=p=>v.getUint32(p,true);
// An independent x86 callback records the wrapper's five real arguments.
// For flare updates it also returns a fixed 4x4 display sample.
function recorder(fill=false){
  const bytes=[];
  for(let i=0;i<5;i++)bytes.push(0x8b,0x44,0x24,4+i*4,0xa3,...Buffer.from(word(0,0xf380+i*4).hex,'hex'));
  if(fill)bytes.push(0x57,0x51,0x8b,0x7c,0x24,28,0xb9,16,0,0,0,0xb8,0x33,0x22,0x11,0xff,0xf3,0xab,0x59,0x5f);
  bytes.push(0xb8,1,0,0,0,0xc2,20,0);return {address:0xf300,hex:Buffer.from(bytes).toString('hex')};
}
const cases=[],out=0x900000;
for(const [width,height,bits]of [[640,480,16],[640,480,32],[3840,2160,32],[6144,3162,32]])
  for(const [w,h]of [[4,4],[128,1]])for(const [x,y]of [[0,0],[-2,-2],[width-w,height-h],[width-1,height-1],
    [width+100,height+100],[1e9,1e9],[-0x80000000,-0x80000000],[3,height-h-1]])
    cases.push({entry:0x10003320,args:[x>>>0,y>>>0,w,h,out],stack:stack-4,
      registers:[0x1234,0x2345,0x3456,0x4567,0,0x5678,0x6789,0x789a],
      memory:[],oracleMemory:[word(0x1000611c,width),word(0x10006120,height),word(0x6bd96c,0xf300),recorder()],
      observe:[{address:0xf380,size:20}],size:[width,height,bits],block:[w,h]});
const clampCases=cases.length,sun=0x800000,root=0x810000,level=0x820000,camera=0x830000,matrix=0x840000;
for(const [visible,lastTick,samples,match,enabled,active,sky]of [
  [0,0x7fffffff,11,true,1,1,1],[1,0,11,true,1,1,1],[1,0x7fffffff,301,false,1,1,1],
  [0,0,0,false,1,1,1],[0,0,0,true,0,1,1],[0,0,0,true,1,0,1],[0,0,0,true,1,1,0],
])for(const [x,y]of [[1,1],[639,479]]){
  const object=Buffer.alloc(0x1a0);object.fill(1,0xa9,0xb7);
  object.writeFloatLE(x,0x12c);object.writeFloatLE(y,0x130);object[0x140]=active;
  object.writeUInt32LE(1,0x144);object.writeUInt32LE(4,0x188);object[0x18d]=visible;
  object.writeUInt32LE(root,0x13c);object.writeUInt32LE(lastTick,0x194);
  object.writeFloatLE(samples,0x198);object.writeFloatLE(1000000,0x19c);
  for(let i=0;i<16;i++)object.writeUInt32LE(match?0xff112233:0,0x148+i*4);
  const cam=Buffer.alloc(0x200);cam.writeUInt32LE(matrix,0xc);cam.writeFloatLE(1,0x1c);cam.writeFloatLE(1,0x20);
  cam.writeUInt32LE(640,0x18);cam.writeUInt32LE(480,0x24);cam.writeFloatLE(37.5,0x130);
  cases.push({entry:0x460460,stack:stack-4,registers:[0,sun,0,0,0,0,0,0],size:[640,480,32],
    memory:[{address:sun,hex:object.toString('hex')},{address:camera,hex:cam.toString('hex')},
      {address:matrix,hex:Buffer.alloc(0x2000).toString('hex')},word(root+0x104,level),word(level+0xdd8,sky),
      word(0x628130,root),word(root+0x10,camera),word(0x657d7c,enabled),word(0x619784,640),word(0x619788,480)],
    oracleMemory:[word(0x1000611c,640),word(0x10006120,480),float(0x10006134,640),float(0x10006130,480),
      float(0x10006080,37.5),word(0x6bd96c,0xf300),recorder(true),word(0x5b2080,0xf350),
      {address:0xf350,hex:'b8e8030000c3'}],
    observe:[{address:sun+0x144,size:4},{address:sun+0x18c,size:1},{address:sun+0x190,size:4},
      {address:sun+0x198,size:4},{address:0xf380,size:20}],flare:true,read:Boolean(enabled&&active&&sky)});
}
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,[new URL('./quality_oracle.py',import.meta.url).pathname],
  {input:JSON.stringify({memorySize:r.memorySize,cases:cases.map(c=>({...c,memory:[...c.memory,...c.oracleMemory]}))}),encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(oracle.status,0,oracle.stderr);
const expected=JSON.parse(oracle.stdout),header=new Int32Array(m.HEAPU8.buffer,m._web_gpu_transport(),8);
const ring=new Uint32Array(m.HEAPU8.buffer,header.byteOffset+32,Atomics.load(header,5));
let current,reads=0,failure;
// A controlled consumer returns display pixels and lets the production HLE
// execute its blocking readback/copy. GPU rasterization has separate tests.
function consume(){try{
  while(Atomics.load(header,1)!==Atomics.load(header,0)){
    const at=Atomics.load(header,1)>>>0,count=ring[at%ring.length],packet=Uint32Array.from({length:count},(_,i)=>ring[(at+i)%ring.length]);
    assert(count>=3&&count<ring.length);const op=packet[1];
    if(op===8){
      reads++;const [p,width,height]=packet.slice(3),[x,y,w,h]=current.rect;
      assert.deepEqual([width,height],current.size.slice(0,2));
      for(let j=0;j<h;j++)for(let i=0;i<w;i++){
        const rgba=current.flare?[0x11,0x22,0x33,255]:[(x+i)&255,(y+j)&255,(0x7d^(x+i)^(y+j))&255,255];
        m.HEAPU8.set(rgba,p+((y+j)*width+x+i)*4);
      }
    }else assert([1,10].includes(op),'Unexpected visibility-test GPU command '+op);
    Atomics.store(header,1,(at+count)|0);Atomics.store(header,2,packet[2]|0);Atomics.notify(header,1);Atomics.notify(header,2);
  }
}catch(e){failure=e;m._web_stop();}}
const timer=setInterval(consume,1);
async function call(entry,args=[]){const result=await r.invokeAsync(entry,args,2000);if(failure)throw failure;assert.equal(result.status,0,result.error);return result;}
const text=s=>{m.HEAPU8.set(new TextEncoder().encode(s+'\0'),r.base+0x880000);return 0x880000;};
const imported=(name,...args)=>call(r.manifest.imports.find(i=>i.name===name).slot,args);
try{
  // Use the original game's CPUID wrapper. Integer MMX is needed by the
  // original flare initializer; unsupported SSE/3DNow paths must stay hidden.
  await call(0x574e6b,[0x880100,0]);
  assert.equal(get(0x880100),1);
  assert.equal(Buffer.from(m.HEAPU8.slice(r.base+0x880104,r.base+0x880110)).toString(),'GenuineIntel');
  await call(0x574e6b,[0x880100,1]);
  assert.equal(get(0x880108)&0x00800111,0x00800111);
  assert.equal(get(0x880108)&0x06000000,0,'Unsupported SSE/SSE2 stay hidden');
  assert.equal(get(0x88010c),0,'Unsupported extended SIMD stays hidden');
  await call(0x574e6b,[0x880100,0x80000000]);
  assert.equal(get(0x880100),0x80000000,'No 3DNow feature leaf');
  m._web_display_size(6144,3162);m._web_gpu_attach();
  const library=(await imported('LoadLibraryA',text('drivers\\opengl3z'))).registers[0];
  const method=async name=>(await imported('GetProcAddress',library,text(name))).registers[0];
  const about=(await call(await method('_THRASH_about@0'))).registers[0],modes=get(about+64),count=get(about+60);
  const mode=await method('_THRASH_setvideomode@12'),readrect=await method('_THRASH_readrect@20');
  put(0x6bd96c,readrect);let selected='';
  for(const [index,c]of cases.entries()){
    if(c.size.join()!==selected){
      selected=c.size.join();let found=0;
      for(let i=1;i<=count;i++)if(c.size.every((x,j)=>get(modes+i*40+j*4)===x)){found=i;break;}
      assert(found,'Missing visibility-test mode '+selected);await call(mode,[found,0,2]);
    }
    for(const memory of c.memory)m.HEAPU8.set(Buffer.from(memory.hex,'hex'),r.base+memory.address);
    c.registers.forEach((x,i)=>m._web_set_register(i,x));
    const recorded=Buffer.from(expected[index].memory.at(-1),'hex');
    current={...c,rect:Array.from({length:4},(_,i)=>recorded.readUInt32LE(i*4))};
    const before=reads,result=await call(c.entry,c.args??[]);
    assert.equal(reads-before,c.flare?Number(c.read):1,'Native visibility readback cadence '+index);
    if(c.flare){
      for(let i=0;i<c.observe.length-1;i++){
        const memory=c.observe[i],actual=Buffer.from(m.HEAPU8.slice(r.base+memory.address,r.base+memory.address+memory.size));
        assert.equal(actual.toString('hex'),expected[index].memory[i],'Native original flare state '+index+'/'+i);
      }
    }else{
      assert.deepEqual(result.registers,expected[index].registers,'Native guarded-readback registers '+index);
      const [x,y,w,h]=current.rect;
      for(let j=0;j<h;j++)for(let i=0;i<w;i++){
        const red=(x+i)&255,green=(y+j)&255,blue=(0x7d^(x+i)^(y+j))&255;
        if(c.size[2]===16)assert.equal(v.getUint16(out+(j*w+i)*2,true),((red>>3)<<11)|((green>>2)<<5)|(blue>>3));
        else assert.equal(get(out+(j*w+i)*4),(0xff000000|red<<16|green<<8|blue)>>>0);
      }
    }
  }
  await writeFile('build/visibility-differential.json',JSON.stringify({clampCases,flareCases:cases.length-clampCases,passed:true})+'\n');
  console.log(`${clampCases} native guarded-readback and ${cases.length-clampCases} original flare visibility comparisons passed (edges, 16/32-bit, 4K/6K, legacy timing and occlusion)`);
}finally{clearInterval(timer);r.stop();r.dispose();}
