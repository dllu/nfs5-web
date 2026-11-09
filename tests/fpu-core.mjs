import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const compiler=resolve('.cache/emsdk/upstream/emscripten/emcc');
const inputs=await Promise.all(['tests/fpu-core.c','src/web_fpu.h'].map(p=>readFile(p)));
await mkdir('build/fpu-core',{recursive:true});
let checks=0;
for(const circular of [false,true]) {
  const name=circular?'circular':'linear',output=resolve(`build/fpu-core/${name}.mjs`);
  const flags=['-O2','-fwrapv','-Isrc',...(circular?['-DWEB_FPU_CIRCULAR']:[]),
    '-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=node','-sSINGLE_FILE=1',
    '-sEXPORTED_FUNCTIONS=["_test_reset","_test_push","_test_push_i64","_test_pop","_test_swap","_test_store","_test_value","_test_low","_test_high","_test_depth"]'];
  const signature=createHash('sha256').update(Buffer.concat(inputs)).update(JSON.stringify(flags)).digest('hex');
  if(await readFile(output+'.hash','utf8').catch(()=>null)!==signature) {
    const built=spawnSync(compiler,['tests/fpu-core.c',...flags,'-o',output],{encoding:'utf8',env:{...process.env,
      EM_CACHE:resolve('.cache/emscripten'),EM_CONFIG:resolve('.cache/emsdk/.emscripten'),TMPDIR:resolve('.cache/tmp')}});
    assert.equal(built.status,0,built.stderr);await writeFile(output+'.hash',signature);
  }
  const {default:create}=await import(output),m=await create();
  let seed=0x783837,depth=0,reference=Array.from({length:8},()=>({value:0,exact:0n}));
  const covered=Array(6).fill(0);
  const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let step=0;step<12000;step++) {
    const op=(random()>>>8)%6,index=(random()>>>8)%8;covered[op]++;
    if(op===0) {
      const value=[0,-0,Infinity,-Infinity,NaN,0.125,-345.75][(random()>>>8)%7];
      m._test_push(value);reference.unshift({value,exact:0n});reference.pop();depth++;
    } else if(op===1) {
      const low=random(),high=random(),exact=BigInt.asIntN(64,BigInt(high)<<32n|BigInt(low));
      m._test_push_i64(low,high);reference.unshift({value:Number(exact),exact});reference.pop();depth++;
    } else if(op===2) {
      assert.deepEqual(m._test_pop(),reference.shift().value);reference.push({value:0,exact:0n});depth--;
    } else if(op===3) {
      m._test_swap(index);[reference[0],reference[index]]=[reference[index],reference[0]];
    } else if(op===4) {
      const value=(random()|0)/64;m._test_store(index,value);reference[index].value=value;
    } else {
      m._test_reset();reference=Array.from({length:8},()=>({value:0,exact:0n}));depth=0;
    }
    assert.equal(m._test_depth(),depth);
    for(let i=0;i<8;i++) {
      assert.deepEqual(m._test_value(i),reference[i].value,`${name} value ${i} at ${step}`);
      const actual=BigInt.asIntN(64,BigInt(m._test_high(i)>>>0)<<32n|BigInt(m._test_low(i)>>>0));
      assert.equal(actual,reference[i].exact,`${name} integer ${i} at ${step}`);
    }
    checks++;
  }
  assert(covered.every(count=>count>1500),'Every stack operation is exercised repeatedly');
}
console.log(`${checks} x87 stack-model transitions passed (push/pop, integer shadows, swaps, stores, reset, all slots)`);
