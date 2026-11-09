import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
process.env.TMPDIR=resolve('.cache/tmp');process.env.XDG_CACHE_HOME=resolve('.cache/xdg');
process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');
await mkdir(process.env.TMPDIR,{recursive:true});
const index=JSON.parse(await readFile('dist/assets.json','utf8'));
const dll=await readFile(new URL('../dist/'+index.entries.find(a=>a.path.toLowerCase()==='drivers/opengl3/opengl3z.dll').url,import.meta.url));
assert.equal(createHash('sha256').update(dll).digest('hex'),'5a57e6c244ea40ea90d69cf13bd3b79144ebca0a980f1d7cb87af48197581f6f');
// Execute the supplied renderer's GLSL. Only its desktop version/precision
// declarations change for WebGL2; projection, clipping and shading stay intact.
const sources=Array.from(dll.toString('latin1').matchAll(/#version 130[^\0]+/g),m=>m[0].replace('#version 130','#version 300 es\nprecision highp float;\nprecision highp int;'));
assert.equal(sources.length,2);
const browser=await chromium.launchPersistentContext(resolve('.cache/chrome-native-shader-test'),{
  executablePath:'/usr/bin/google-chrome',headless:false,viewport:{width:800,height:700},
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes')],
});
try{
  const page=await browser.newPage(),session=await browser.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled',{cacheDisabled:true});
  await page.goto('http://127.0.0.1:8000');
  const report=await page.evaluate(async sources=>{
    const {createRenderer}=await import('./renderer.mjs');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;document.body.prepend(canvas);
    const renderer=await createRenderer(canvas),reference=document.createElement('canvas');reference.width=reference.height=64;
    const gl=reference.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:false});
    if(!gl)throw new Error('WebGL2 native-shader reference unavailable');
    function shader(type,source){
      const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;
    }
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,sources[0]));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,sources[1]));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const location=name=>gl.getUniformLocation(program,name);
    gl.uniformMatrix4fv(location('mvp'),false,new Float32Array([2/64,0,0,0,0,-2/64,0,0,0,0,2,0,-1,1,-1,1]));
    gl.uniform1i(location('texEnabled'),0);gl.uniform1i(location('shadeModel'),1);
    gl.uniform1ui(location('alphaFunc'),7);gl.uniform1f(location('gamma'),1);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    for(const [name,size,type,normalized,offset]of [
      ['vCoord',4,gl.FLOAT,false,0],['vDiffuse',4,gl.UNSIGNED_BYTE,true,16],
      ['vSpecular',4,gl.UNSIGNED_BYTE,true,20],['vTexCoord',2,gl.FLOAT,false,24],
    ]){
      const at=gl.getAttribLocation(program,name);if(at<0)continue;
      gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,type,normalized,32,offset);
    }
    const mesh=Uint32Array.of(0,1,2,0,2,3),elements=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,elements);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh,gl.STATIC_DRAW);
    const cases=[];
    for(const mode of [2,4,8])for(const alpha of [0,64,128,255])cases.push({mode,alpha,near:1,far:6,density:.35,rhw:[1,.125,.25,2]});
    cases.push({mode:2,alpha:192,near:6,far:1,density:0,rhw:[1,.125,.25,2]});
    for(const mode of [4,8])for(const density of [0,-.35])cases.push({mode,alpha:255,near:1,far:6,density,rhw:[1,.125,.25,2]});
    cases.push({mode:2,alpha:255,near:0,far:4,density:1,rhw:[0,.25,1,.5]});
    async function compare(){
      const native=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,native);
      if(gl.getError()!==gl.NO_ERROR)throw new Error('Native shader reference GL error');
      const actual=await renderer.readPixels();let largest=0,errors=0;
      for(let y=4;y<60;y++)for(let x=4;x<60;x++)for(let channel=0;channel<4;channel++){
        const error=Math.abs(actual[(y*64+x)*4+channel]-native[((63-y)*64+x)*4+channel]);
        largest=Math.max(largest,error);if(error>1)errors++;
      }
      return {largest,errors};
    }
    const results=[],geometry=[];
    try{
      for(const [index,c]of cases.entries()){
        const vertices=new Uint8Array(128),view=new DataView(vertices.buffer);
        for(let i=0;i<4;i++){
          [i===1||i===2?64:0,i>=2?64:0,.5,c.rhw[i]].forEach((x,j)=>view.setFloat32(i*32+j*4,x,true));
          view.setUint32(i*32+16,0xb4c85014,true);view.setUint32(i*32+20,0x10101010,true);
        }
        gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STREAM_DRAW);
        gl.uniform1ui(location('fogMode'),c.mode);gl.uniform4f(location('fogColor'),32/255,80/255,192/255,c.alpha/255);
        gl.uniform1f(location('fogStart'),c.near);gl.uniform1f(location('fogEnd'),c.far);gl.uniform1f(location('fogDensity'),c.density);
        gl.uniform1i(location('specularEnabled'),1);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_INT,0);
        renderer.clear(0);renderer.draw(vertices,mesh,{fog_enable:1,fog_color:(c.alpha*0x1000000+0x2050c0)>>>0,
          fog_mode:{2:1,4:2,8:3}[c.mode],fog_near:c.near,fog_far:c.far,fog_density:c.density,shade_mode:2});
        const {largest,errors}=await compare();
        results.push({...c,largest,errors});
        if(errors)throw new Error(`Native fog pixels differ in case ${index}: max ${largest}, ${errors} components; ${JSON.stringify(c)}`);
      }
      const pixels=new Uint8Array(8*8*4);
      for(let y=0;y<8;y++)for(let x=0;x<8;x++)pixels.set([15+x*31,7+y*29,20+(x+y)*13,255],(y*8+x)*4);
      const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,8,8,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.LINEAR);
      for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.CLAMP_TO_EDGE);
      gl.uniform1i(location('tex01'),0);renderer.textureCreate(1,8,8,pixels);
      gl.uniform1ui(location('fogMode'),0);gl.uniform1i(location('specularEnabled'),0);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);
      function quad({z=[.5,.5,.5,.5],rhw=[1,1,1,1],colors=[0xffc06030],inset=0,invalidUV=false}={}){
        const bytes=new Uint8Array(128),view=new DataView(bytes.buffer);
        for(let i=0;i<4;i++){
          const right=i===1||i===2,bottom=i>=2;
          [right?64-inset:inset,bottom?64-inset:inset,z[i],rhw[i]].forEach((value,j)=>view.setFloat32(i*32+j*4,value,true));
          view.setUint32(i*32+16,colors[i%colors.length],true);
          view.setFloat32(i*32+24,invalidUV?NaN:Number(right),true);view.setFloat32(i*32+28,invalidUV?NaN:Number(bottom),true);
        }
        return bytes;
      }
      function draw(bytes,{textured=false,shade=1}={}){
        gl.uniform1i(location('texEnabled'),Number(textured));gl.uniform1i(location('shadeModel'),Number(shade!==0));
        gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.STREAM_DRAW);gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_INT,0);
        renderer.draw(bytes,mesh,{texture:Number(textured),filter_linear:1,address_wrap:0,alpha_modulate:1,
          depth_test:1,depth_write:1,shade_mode:shade});
      }
      const textured={textured:true,colors:[0xffffffff]};
      const geometryCases=[
        {name:'ordinary depth',z:[.25,.25,.25,.25]},
        {name:'negative depth clips',z:[-.25,-.25,-.25,-.25]},
        {name:'near-plane crossing',z:[-.5,.5,.5,-.5]},
        {name:'depth above one resets to zero',z:[1.25,1.25,1.25,1.25]},
        {name:'mixed depth reset',z:[1.25,.5,.5,1.25]},
        {name:'depth exactly one stays behind',z:[1,1,1,1]},
        {name:'untextured zero RHW',rhw:[0,0,0,0]},
        {name:'untextured unused UV',invalidUV:true},
        {name:'projected positive RHW',...textured,rhw:[1,.125,.25,2]},
        {name:'zero RHW vertex',...textured,rhw:[0,.25,1,.5]},
        {name:'negative RHW vertices',...textured,rhw:[-1,-.125,-.25,-2]},
        {name:'mixed-sign RHW vertices',...textured,rhw:[-1,.125,.25,2]},
        {name:'small RHW retains projection',...textured,rhw:[1e-8,1.25e-9,2.5e-9,2e-8]},
        {name:'screen clipping with negative RHW',...textured,rhw:[-1,-.125,-.25,-2],inset:-16},
        {name:'projected UV across near plane',...textured,z:[-.5,.5,.5,-.5],rhw:[1,.125,.25,2]},
        {name:'flat color across near plane',shade:0,z:[-.5,.5,.5,-.5],colors:[0xffe01040,0xff10e040,0xff1040e0,0xffe0e010]},
        {name:'smooth color with negative RHW',rhw:[-1,-.125,-.25,-2],colors:[0xffe01040,0xff10e040,0xff1040e0,0xffe0e010]},
      ];
      for(const c of geometryCases){
        gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);renderer.clear(0);
        draw(quad({z:[.375,.375,.375,.375],colors:[0xff204060]}));
        // Subjects that test interpolation must be in front of the background.
        const parameters={z:[.25,.25,.25,.25],...c};
        draw(quad(parameters),parameters);geometry.push({...c,...await compare()});
      }
      gl.deleteTexture(texture);
      await renderer.validate();return {cases:results,geometry,gpuErrors:renderer.errors};
    }finally{renderer.close();gl.getExtension('WEBGL_lose_context')?.loseContext();}
  },sources);
  assert.deepEqual(report.gpuErrors,[]);
  await writeFile('build/native-fog-renderer.json',JSON.stringify(report,null,2)+'\n');
  console.log(`${report.cases.length} native GLSL fog pixel comparisons passed (interpolation, ARGB strength, linear/exp/exp2, density and zero RHW)`);
  await writeFile('build/native-geometry-renderer.json',JSON.stringify(report.geometry,null,2)+'\n');
  assert.deepEqual(report.geometry.filter(c=>c.errors),[],'Native GLSL geometry pixel differences');
  console.log(`${report.geometry.length} native GLSL geometry comparisons passed (depth/clipping, projected UV, signed/zero/small RHW and flat/smooth color)`);
}finally{await browser.close();}
