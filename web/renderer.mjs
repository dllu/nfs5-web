// WebGPU target for the game's Thrash interface. Geometry and effect uniforms
// upload in batches; consecutive compatible draws share one drawIndexed call.
const defaults = {
  texture: 0, depth_test: 0, depth_write: 0, blend_enable: 0, src_blend: 5, dst_blend: 6,
  filter_linear: 1, address_wrap: 1, cull: 1, alpha_test: 0, alpha_ref: 0,
  fog_enable: 0, fog_color: 0, fog_near: 0, fog_far: 1, primitive: 0, depth_func: 4,
  scissor_enable: 0, scissor_x: 0, scissor_y: 0, scissor_w: 0, scissor_h: 0,
  alpha_modulate: 0, fog_mode: 0, fog_density: 1, shade_mode: 1,
  mip_filter: 0, address_u: null, address_v: null, mip_lod_bias: 0, alpha_func: 6,
  stencil_enable: 0, stencil_func: 7, stencil_fail: 0, stencil_depth_fail: 0, stencil_pass: 0,
  stencil_ref: 2, stencil_read_mask: 255, stencil_write_mask: 255, color_write: 1, gamma: 1,
};
export function mipLayout(width,height,levels=1) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
     !Number.isInteger(levels)||levels<1||levels>1+Math.floor(Math.log2(Math.max(width,height))))throw new Error('Invalid texture mip layout');
  const layout=[];let offset=0;
  for(let level=0;level<levels;level++) {
    const length=width*height*4;layout.push({level,width,height,offset,length});offset+=length;
    width=Math.max(1,width>>1);height=Math.max(1,height>>1);
  }
  return {layout,size:offset};
}
const rgba = value => [(value >>> 16 & 255) / 255, (value >>> 8 & 255) / 255, (value & 255) / 255, (value >>> 24) / 255];
export function effectUniforms(width,height,state,complete=false) {
  if(!complete)state={...defaults,...state};
  // effects.w: bit 0 modulates diffuse alpha, bit 1 enables texturing.
  const textureFlags=state.texture?2+Number(Boolean(state.alpha_modulate)):1;
  return [width,height,state.shade_mode,Number.isFinite(state.mip_lod_bias)?state.mip_lod_bias:0,
    ...rgba(state.fog_color),state.alpha_test?state.alpha_func:7,state.alpha_ref/255,state.fog_enable,textureFlags,
    state.fog_mode,state.fog_density,state.fog_near,state.fog_far,state.gamma,0,0,0];
}
const blendFactors = ['one','zero','one','src','one-minus-src','src-alpha','one-minus-src-alpha','dst-alpha','one-minus-dst-alpha','dst','one-minus-dst','src-alpha-saturated'];
const compares = ['less-equal','never','less','equal','less-equal','greater','not-equal','greater-equal','always'];
const stencilCompares=['never','less','equal','less-equal','greater','not-equal','greater-equal','always'];
const stencilOps=['keep','zero','replace','increment-clamp','decrement-clamp','invert','increment-wrap','decrement-wrap'];
const presentation = `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;
struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Output {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: Output; out.position = vec4f(p * 2.0 - 1.0, 0.0, 1.0); out.uv = vec2f(p.x, 1.0 - p.y); return out;
}
@fragment fn fs(input: Output) -> @location(0) vec4f { return textureSample(image, image_sampler, input.uv); }
`;
// Match the old CPU resampler's integer center-of-pixel rule, including ties.
const scaledRead = `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<uniform> extent: vec2u;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let texel = (vec2u(p.xy) * 2u + 1u) * textureDimensions(image) / (extent * 2u);
  return textureLoad(image, vec2i(texel), 0);
}
`;

export async function selectAdapter(gpu) {
  let fallback;
  // powerPreference is a hint. Some browsers expose different adapters for
  // different hints/backends; exhaust those before accepting a CPU adapter.
  for (const options of [
    {powerPreference:'high-performance'}, {powerPreference:'low-power'}, {},
    {powerPreference:'high-performance',featureLevel:'compatibility'},
  ]) {
    try {
      const adapter=await gpu.requestAdapter({...options,forceFallbackAdapter:false});
      if(!adapter)continue;
      if(!(adapter.info?.isFallbackAdapter??adapter.isFallbackAdapter))return adapter;
      fallback??=adapter;
    } catch { /* Unsupported feature levels/preferences may reject. */ }
  }
  return fallback;
}

export async function createRenderer(canvas, { onResize = () => {}, onError = () => {}, frontendSize, depthFormat: requestedDepthFormat } = {}) {
  if (!navigator.gpu) throw new Error('This browser does not expose WebGPU');
  const adapter = await selectAdapter(navigator.gpu);
  if (!adapter) throw new Error('No WebGPU adapter is available');
  const depthFormat=requestedDepthFormat??(adapter.features.has('depth32float-stencil8')?'depth32float-stencil8':'depth24plus-stencil8');
  if(!['depth32float-stencil8','depth24plus-stencil8'].includes(depthFormat))throw new Error('Unsupported depth/stencil format');
  const device = await adapter.requestDevice({ requiredFeatures:depthFormat==='depth32float-stencil8'?['depth32float-stencil8']:[],requiredLimits: { maxTextureDimension2D: Math.min(16384, adapter.limits.maxTextureDimension2D) } });
  const errors = [];
  device.addEventListener('uncapturederror', event => { errors.push(event.error.message); onError(event.error.message); });
  let closed = false;
  device.lost.then(info => { if (!closed) { errors.push(info.message || 'WebGPU device lost'); onError(errors.at(-1)); } });
  const source = await fetch(new URL('./thrash.wgsl', import.meta.url));
  if (!source.ok) { device.destroy(); throw new Error(`Unable to load renderer shader: HTTP ${source.status}`); }
  const shader = device.createShaderModule({ label: 'Thrash', code: await source.text() });
  const compilation = await shader.getCompilationInfo();
  const failures = compilation.messages.filter(item => item.type === 'error');
  if (failures.length) { device.destroy(); throw new Error(failures.map(item => item.message).join('\n')); }
  const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 80 } }] });
  const textureLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
  ] });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [uniformLayout, textureLayout] });
  const textures = new Map(), samplers = new Map(), pipelines = new Map();
  const normalized=new WeakMap();
  const stats = { frames: 0, canvasFrames:0,draws: 0, batches: 0, vertices: 0, submissions: 0, readbackBytes: 0, readbackBufferBytes: 0, pendingFrames:0, peakPendingFrames:0, pipelineBinds:0,uniformBinds:0,textureBinds:0,readbackAllocations:0,gpuWaitMs:0,readbackWaitMs:0 };
  const readBuffers=[],longFrames=[];let previousGpuWait=0,previousReadbackWait=0;
  const frames=[];
  const intervals=new Float64Array(600);let intervalCount=0,lastPresent=0;
  function resetTiming(){intervalCount=0;lastPresent=0;longFrames.length=0;previousGpuWait=stats.gpuWaitMs;previousReadbackWait=stats.readbackWaitMs;}
  function timing(){
    const values=Array.from(intervals.subarray(0,Math.min(intervalCount,intervals.length))).sort((a,b)=>a-b);
    const percentile=f=>values[Math.min(values.length-1,Math.floor(values.length*f))]??0;
    return {samples:values.length,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:values.at(-1)??0,over33ms:values.filter(v=>v>1000/30).length,recentLongFrames:longFrames.slice()};
  }
  let width = 0, height = 0, outputWidth=0, outputHeight=0, color, depth, colorView, depthView, presentGroup, readSurface,readGroup,readWidth=0,readHeight=0;
  let vertices = new Uint8Array(512 * 1024), indices = new Uint32Array(32768), uniforms = new Float32Array(64 * 1024);
  let vertexBytes = 0, indexCount = 0, uniformBytes = 0, operations = [], imageStrip;
  const uniformOffsets=new Map();
  let vertexBuffer, indexBuffer, uniformBuffer, uniformGroup;
  let vertexCapacity = 0, indexCapacity = 0, uniformCapacity = 0;
  const context = canvas.getContext('webgpu');
  if (!context) { device.destroy(); throw new Error('Unable to create a WebGPU canvas context'); }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const presentShader = device.createShaderModule({ code: presentation });
  const presentPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: presentShader, entryPoint: 'vs' }, fragment: { module: presentShader, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const readShader=device.createShaderModule({code:scaledRead});
  const readPipeline = device.createRenderPipeline({layout:'auto',vertex:{module:readShader,entryPoint:'vs'},fragment:{module:readShader,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
  const readExtent=device.createBuffer({size:8,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const presentSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

  function check() { if (closed) throw new Error('Renderer is closed'); if (errors.length) throw new Error(errors[0]); }
  function sampler(state) {
    const key = samplerKey(state);
    if (!samplers.has(key)) samplers.set(key, device.createSampler({
      magFilter: state.filter_linear ? 'linear' : 'nearest', minFilter: state.filter_linear ? 'linear' : 'nearest',
      mipmapFilter:state.mip_filter===2?'linear':'nearest',lodMaxClamp:state.mip_filter?32:0,
      addressModeU:['clamp-to-edge','repeat','mirror-repeat'][state.address_u],
      addressModeV:['clamp-to-edge','repeat','mirror-repeat'][state.address_v],
    }));
    return samplers.get(key);
  }
  function samplerKey(state) {return state.samplerKey??`${Boolean(state.filter_linear)}:${state.mip_filter}:${state.address_u}:${state.address_v}`;}
  function textureGroup(state) {
    const entry = textures.get(state.texture);
    if (!entry) throw new Error(`Unknown GPU texture ${state.texture}`);
    const key = samplerKey(state);
    if (!entry.groups.has(key)) entry.groups.set(key, device.createBindGroup({ layout: textureLayout, entries: [
      { binding: 0, resource: entry.texture.createView() }, { binding: 1, resource: sampler(state) },
    ] }));
    return entry.groups.get(key);
  }
  function pipeline(state) {
    if(state.pipeline)return state.pipeline;
    const key = [state.depth_test,state.depth_write,state.blend_enable,state.src_blend,state.dst_blend,state.cull,state.primitive,state.depth_func,
      state.stencil_enable,state.stencil_func,state.stencil_fail,state.stencil_depth_fail,state.stencil_pass,state.stencil_read_mask,state.stencil_write_mask,state.color_write].join(':');
    if (!pipelines.has(key)) {
      const target = { format: 'rgba8unorm',writeMask:state.color_write?GPUColorWrite.ALL:0 };
      if (state.blend_enable) {
        const component = { srcFactor: blendFactors[state.src_blend], dstFactor: blendFactors[state.dst_blend], operation: 'add' };
        if (!component.srcFactor || !component.dstFactor) throw new Error('Unsupported Thrash blend factor');
        target.blend = { color: component, alpha: component };
      }
      const stencilFace=state.stencil_enable?{compare:stencilCompares[state.stencil_func],failOp:stencilOps[state.stencil_fail],depthFailOp:stencilOps[state.stencil_depth_fail],passOp:stencilOps[state.stencil_pass]}:{};
      pipelines.set(key, device.createRenderPipeline({ layout: pipelineLayout,
        vertex: { module: shader, entryPoint: 'vertex_main', buffers: [{ arrayStride: 32, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'unorm8x4' },
          { shaderLocation: 2, offset: 20, format: 'unorm8x4' }, { shaderLocation: 3, offset: 24, format: 'float32x2' },
        ] }] },
        fragment: { module: shader, entryPoint: 'fragment_main', targets: [target] },
        primitive: { topology: ['triangle-list','line-list','point-list'][state.primitive], frontFace: 'cw', cullMode: state.primitive ? 'none' : state.cull === 2 ? 'front' : state.cull === 3 ? 'back' : 'none' },
        depthStencil: { format:depthFormat,depthWriteEnabled:Boolean(state.depth_test&&state.depth_write),depthCompare:state.depth_test?compares[state.depth_func]??'less-equal':'always',
          stencilFront:stencilFace,stencilBack:stencilFace,stencilReadMask:state.stencil_read_mask,stencilWriteMask:state.stencil_enable?state.stencil_write_mask:0 },
      }));
    }
    return state.pipeline=pipelines.get(key);
  }
  function grow(array, required) {
    if (array.length >= required) return array;
    let capacity = array.length; while (capacity < required) capacity *= 2;
    if (capacity * array.BYTES_PER_ELEMENT > device.limits.maxBufferSize) throw new Error('Renderer batch exceeds the GPU buffer limit');
    const result = new array.constructor(capacity); result.set(array); return result;
  }
  function gpuBuffer(old, capacity, required, usage) {
    if (capacity >= required && old) return [old, capacity];
    old?.destroy(); let size = Math.max(256, capacity); while (size < required) size *= 2;
    return [device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST }), size];
  }
  function flush(target) {
    check(); if (!operations.length) return;
    if (vertexBytes) {
      [vertexBuffer, vertexCapacity] = gpuBuffer(vertexBuffer, vertexCapacity, vertexBytes, GPUBufferUsage.VERTEX);
      [indexBuffer, indexCapacity] = gpuBuffer(indexBuffer, indexCapacity, indexCount * 4, GPUBufferUsage.INDEX);
      const previous = uniformBuffer;
      [uniformBuffer, uniformCapacity] = gpuBuffer(uniformBuffer, uniformCapacity, uniformBytes, GPUBufferUsage.UNIFORM);
      if (previous !== uniformBuffer) uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer, size: 80 } }] });
      device.queue.writeBuffer(vertexBuffer, 0, vertices, 0, vertexBytes);
      device.queue.writeBuffer(indexBuffer, 0, indices, 0, indexCount);
      device.queue.writeBuffer(uniformBuffer, 0, uniforms, 0, uniformBytes / 4);
    }
    const encoder = target ?? device.createCommandEncoder(); let pass,bound,pipelineBound,uniformBound,textureBound,stencilBound,scissorBound;
    const begin = clear => encoder.beginRenderPass({ colorAttachments: [{ view: colorView, loadOp: clear?.mask&1 ? 'clear' : 'load', storeOp: 'store', clearValue: clear ? rgba(clear.color) : [0,0,0,1] }],
      depthStencilAttachment: { view:depthView,depthLoadOp:clear?.mask&2?'clear':'load',depthStoreOp:'store',depthClearValue:clear?Math.max(0,Math.min(1,clear.depth)):1,
        stencilLoadOp:clear?.mask&4?'clear':'load',stencilStoreOp:'store',stencilClearValue:clear?.stencil??0 } });
    for (const operation of operations) {
      if (operation.type === 'clear') { pass?.end(); pass = begin(operation);bound=false;pipelineBound=uniformBound=textureBound=stencilBound=scissorBound=undefined;continue; }
      pass ??= begin(null);
      const state = operation.state;
      if (state.scissor_enable && (!state.scissor_w || !state.scissor_h || state.scissor_x >= width || state.scissor_y >= height)) continue;
      const p=pipeline(state),texture=textureGroup(state),stencil=Math.min(255,state.stencil_ref>>>0);
      if(p!==pipelineBound){pass.setPipeline(p);pipelineBound=p;stats.pipelineBinds++;}
      if(!bound){pass.setVertexBuffer(0,vertexBuffer);pass.setIndexBuffer(indexBuffer,'uint32');bound=true;}
      if(stencil!==stencilBound){pass.setStencilReference(stencil);stencilBound=stencil;}
      if(operation.uniformOffset!==uniformBound){pass.setBindGroup(0,uniformGroup,[operation.uniformOffset]);uniformBound=operation.uniformOffset;stats.uniformBinds++;}
      if(texture!==textureBound){pass.setBindGroup(1,texture);textureBound=texture;stats.textureBinds++;}
      const x=state.scissor_enable?Math.round(state.scissor_x*outputWidth/width):0;
      const y=state.scissor_enable?Math.round(state.scissor_y*outputHeight/height):0;
      const right=state.scissor_enable?Math.round(Math.min(width,state.scissor_x+state.scissor_w)*outputWidth/width):outputWidth;
      const bottom=state.scissor_enable?Math.round(Math.min(height,state.scissor_y+state.scissor_h)*outputHeight/height):outputHeight;
      if(right<=x||bottom<=y)continue;
      if(!scissorBound||x!==scissorBound[0]||y!==scissorBound[1]||right!==scissorBound[2]||bottom!==scissorBound[3]){
        pass.setScissorRect(x,y,right-x,bottom-y);scissorBound=[x,y,right,bottom];
      }
      pass.drawIndexed(operation.count, 1, operation.first); stats.batches++;
    }
    pass?.end();
    if (!target) { device.queue.submit([encoder.finish()]); stats.submissions++; }
    vertexBytes = indexCount = uniformBytes = 0; operations = []; imageStrip=null;uniformOffsets.clear();
  }
  function resize(w, h) {
    check(); if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > device.limits.maxTextureDimension2D || h > device.limits.maxTextureDimension2D) throw new Error(`Unsupported renderer size ${w}x${h}`);
    let ow=w,oh=h;
    if(w===640&&h===480&&frontendSize&&!(adapter.info?.isFallbackAdapter??adapter.isFallbackAdapter)) {
      const scale=Math.max(1,Math.min(frontendSize.width/640,frontendSize.height/480,device.limits.maxTextureDimension2D/640));
      ow=Math.round(640*scale);oh=Math.round(480*scale);
    }
    if (w === width && h === height&&ow===outputWidth&&oh===outputHeight) return;
    flush(); color?.destroy(); depth?.destroy();readSurface?.destroy();readSurface=null;
    width = w; height = h;outputWidth=ow;outputHeight=oh;canvas.width=ow;canvas.height=oh;resetTiming();
    color = device.createTexture({ size: [ow,oh], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    depth = device.createTexture({ size: [ow,oh], format:depthFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT });
    colorView=color.createView();depthView=depth.createView();
    presentGroup = device.createBindGroup({ layout: presentPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: colorView }, { binding: 1, resource: presentSampler }] });
    operations.push({ type: 'clear', color: 0xff000000, depth: 1,stencil:0,mask:7 }); onResize(w,h);
  }
  function clear(color, depth = 1, {mask=7,stencil=0,rect}={}) {
    check();mask&=7;stencil&=255;if(!mask)return;imageStrip=null;
    if(rect&&(rect.x!==0||rect.y!==0||rect.width!==width||rect.height!==height)) {
      if(!rect.width||!rect.height||rect.x>=width||rect.y>=height)return;
      // Scissored clears bypass the game's texture, alpha, depth comparison
      // and stencil comparison/ops, while writing only selected aspects.
      const bytes=new Uint8Array(96),view=new DataView(bytes.buffer);
      [[0,0],[width*2,0],[0,height*2]].forEach(([x,y],i)=>{
        view.setFloat32(i*32,x,true);view.setFloat32(i*32+4,y,true);
        view.setFloat32(i*32+8,Math.max(0,Math.min(1,depth)),true);view.setFloat32(i*32+12,1,true);view.setUint32(i*32+16,color,true);
      });
      draw(bytes,null,{depth_test:1,depth_write:Number(Boolean(mask&2)),depth_func:8,color_write:Number(Boolean(mask&1)),
        stencil_enable:Number(Boolean(mask&4)),stencil_pass:2,stencil_ref:stencil,
        scissor_enable:1,scissor_x:rect.x,scissor_y:rect.y,scissor_w:rect.width,scissor_h:rect.height});return;
    }
    const operation={type:'clear',color,depth,stencil,mask};
    const last=operations.at(-1);
    if(last?.type==='clear'&&last.mask===mask)operations[operations.length-1]=operation;else operations.push(operation);
  }
  function draw(data, mesh, requested = {}) {
    check();let state=requested.serial===undefined?null:normalized.get(requested);
    if(!state){
      state={...defaults,...requested};
      state.address_u??=state.address_wrap?1:0;state.address_v??=state.address_wrap?1:0;
      state.key=state.serial===undefined?Object.values(state).join(':'):`${state.serial}:${state.primitive}`;
      state.samplerKey=samplerKey(state);
      if(requested.serial!==undefined)normalized.set(requested,state);
    }
    if (!(data instanceof Uint8Array) || data.byteLength % 32) throw new Error('Invalid Thrash vertex buffer');
    const count = data.byteLength / 32, n = mesh ? mesh.length : count; if (!n) return;
    const key=state.key;
    vertices = grow(vertices, vertexBytes + data.byteLength); vertices.set(data, vertexBytes);
    // The frontend's rotating picture is sixteen separate, nearly touching
    // textured strips. Tiny transform differences leave subpixel cracks that
    // occasionally cover an entire raster row. Weld a shared image edge only
    // when BOTH endpoints and their texture coordinates already coincide to
    // within half a screen pixel / one texel. Larger animation gaps stay open.
    const entry=textures.get(state.texture);
    const strip=width===640&&height===480&&count===6&&(!mesh||mesh.length===6&&mesh.every((index,i)=>index===i))&&state.texture&&entry&&!state.address_wrap&&
      !state.fog_enable&&state.primitive===0&&state.depth_test&&state.blend_enable;
    if(strip) {
      const view=new DataView(vertices.buffer), previous=imageStrip;
      const point=i=>Array.from({length:4},(_,j)=>view.getFloat32(i*32+j*4,true));
      const uv=i=>[view.getFloat32(i*32+24,true),view.getFloat32(i*32+28,true)];
      const offset=vertexBytes/32;
      // The rotating panel changes winding as it turns. Recover its four
      // unique corners independently of either triangle's vertex order.
      const ids=[0,1,2,3,4,5].map(i=>offset+i), p=ids.map(point);
      const corners=ids.filter((id,i)=>!p.slice(0,i).some(q=>q.every((v,j)=>v===p[i][j])))
        .sort((a,b)=>p[a-offset][1]-p[b-offset][1]);
      const top=corners.slice(0,2).sort((a,b)=>p[a-offset][0]-p[b-offset][0]);
      const bottom=corners.slice(2).sort((a,b)=>p[a-offset][0]-p[b-offset][0]);
      const panel=corners.length===4&&Math.abs(p[top[0]-offset][1]-p[top[1]-offset][1])<.01&&
        Math.abs(p[bottom[0]-offset][1]-p[bottom[1]-offset][1])<.01&&
        p[top[1]-offset][0]-p[top[0]-offset][0]>8*(p[bottom[0]-offset][1]-p[top[0]-offset][1]);
      if(panel&&previous?.key===key) {
        const adjacent=(a,b)=>{
          const x=point(a),y=point(b),u=uv(a),v=uv(b);
          return Math.hypot(x[0]-y[0],x[1]-y[1])<=.5&&Math.abs(x[2]-y[2])<.0001&&
            Math.abs(u[0]-v[0])<=1/entry.layout[0].width&&Math.abs(u[1]-v[1])<=1/entry.layout[0].height;
        };
        for(const [current,prior] of [[bottom,previous.top],[top,previous.bottom]]) {
          if(!current.every((a,i)=>adjacent(a,prior[i])))continue;
          for(let i=0;i<2;i++) {
            const source=point(prior[i]);
            for(const id of ids)if(p[id-offset].every((v,j)=>v===p[current[i]-offset][j]))
              source.forEach((v,j)=>view.setFloat32(id*32+j*4,v,true));
          }
          break;
        }
      }
      imageStrip=panel?{key,top,bottom}:null;
    } else imageStrip=null;
    indices = grow(indices, indexCount + n); const first = indexCount, base = vertexBytes / 32;
    const primitiveSize=state.primitive===0?3:state.primitive===1?2:1;
    for (let i = 0; i < n; i++) {
      // OpenGL's last vertex supplies flat diffuse color; WebGPU uses the
      // first. Rotate triangles (preserving winding), reverse line pairs.
      const start=i-i%primitiveSize;
      const source=state.shade_mode===0&&start+primitiveSize<=n?start+(i%primitiveSize+primitiveSize-1)%primitiveSize:i;
      const index = mesh ? mesh[source] : source; if (index >= count) throw new Error('Thrash mesh index exceeds its vertex buffer');
      indices[indexCount++] = base + index;
    }
    const last = operations.at(-1);
    if (last?.type === 'draw' && last.key === key) last.count += n;
    else {
      if(state.uniformWidth!==width||state.uniformHeight!==height){state.uniformValues=effectUniforms(width,height,state,true);state.uniformKey=state.uniformValues.join(':');state.uniformWidth=width;state.uniformHeight=height;}
      let offset=uniformOffsets.get(state.uniformKey);
      if(offset===undefined){
        offset=uniformBytes;uniforms=grow(uniforms,(uniformBytes+256)/4);uniforms.set(state.uniformValues,uniformBytes/4);uniformBytes+=256;uniformOffsets.set(state.uniformKey,offset);
      }
      operations.push({ type: 'draw', state, key, first, count: n, uniformOffset: offset });
    }
    vertexBytes += data.byteLength; stats.draws++; stats.vertices += count;
  }
  function textureCreate(id, w, h, pixels = null, mipLevels = 1) {
    check();const {layout,size}=mipLayout(w,h,mipLevels);
    if (textures.has(id) || w>device.limits.maxTextureDimension2D || h>device.limits.maxTextureDimension2D || (pixels && pixels.length!==size)) throw new Error('Invalid texture creation');
    const texture = device.createTexture({ size: [w,h], mipLevelCount:mipLevels, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const entry={texture,layout,size,groups:new Map()};textures.set(id,entry);
    if(pixels)writeTexture(entry,pixels);
  }
  function writeTexture(entry,pixels) {
    for(const {level,width,height,offset,length} of entry.layout)
      device.queue.writeTexture({texture:entry.texture,mipLevel:level},pixels.subarray(offset,offset+length),{bytesPerRow:width*4,rowsPerImage:height},[width,height]);
  }
  function textureUpdate(id, pixels) {
    check(); const entry = textures.get(id); if (!entry || pixels.length !== entry.size) throw new Error('Invalid texture update');
    flush();writeTexture(entry,pixels);
  }
  function textureDestroy(id) { check(); if (!id) return; flush(); textures.get(id)?.texture.destroy(); textures.delete(id); }
  function reset() { flush();for(const [id,entry] of textures)if(id){entry.texture.destroy();textures.delete(id);}clear(0xff000000); }
  function present(visible=true,focused=true) {
    const now=performance.now();
    if(lastPresent){
      const interval=now-lastPresent;intervals[intervalCount++%intervals.length]=interval;
      if(visible&&focused&&interval>1000/30){
        if(longFrames.length===32)longFrames.shift();
        longFrames.push({at:performance.timeOrigin+now,ms:interval,gpuWaitMs:stats.gpuWaitMs-previousGpuWait,completedReadbackWaitMs:stats.readbackWaitMs-previousReadbackWait,pendingFrames:stats.pendingFrames,width,height});
      }
    }
    lastPresent=now;previousGpuWait=stats.gpuWaitMs;previousReadbackWait=stats.readbackWaitMs;
    const encoder = device.createCommandEncoder(); flush(encoder);
    // Hidden tabs keep the offscreen framebuffer and native simulation alive
    // without requesting a compositor surface that the browser may suspend.
    if(visible){
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,1] }] });
      pass.setPipeline(presentPipeline); pass.setBindGroup(0,presentGroup); pass.draw(3); pass.end();
      stats.canvasFrames++;
    }
    device.queue.submit([encoder.finish()]); stats.frames++; stats.submissions++;
    const done=device.queue.onSubmittedWorkDone();frames.push(done);stats.pendingFrames++;
    stats.peakPendingFrames=Math.max(stats.peakPendingFrames,stats.pendingFrames);
    done.then(()=>{stats.pendingFrames--;if(frames[0]===done)frames.shift();},()=>{stats.pendingFrames--;if(frames[0]===done)frames.shift();});
  }
  async function frameBudget() { if(frames.length>=2){const start=performance.now();await frames[0];stats.gpuWaitMs+=performance.now()-start;}check(); }
  function flushHint(){if(vertexBytes>=256*1024)flush();}
  async function readPixels({x=0,y=0,output=false,scaled,width:w=scaled?.width??(output?outputWidth:width),height:h=scaled?.height??(output?outputHeight:height)}={}) {
    check();
    const sw=scaled?.width??(output?outputWidth:width),sh=scaled?.height??(output?outputHeight:height);
    const maxSize=device.limits.maxTextureDimension2D;
    if(![x,y,w,h,sw,sh].every(Number.isInteger)||x<0||y<0||w<1||h<1||x+w>sw||y+h>sh||sw>maxSize||sh>maxSize||(scaled&&output))throw new Error('Invalid readback rectangle');
    const encoder = device.createCommandEncoder(); flush(encoder); const stride = Math.ceil(w*4/256)*256;
    let sourceTexture=color;
    if(sw!==outputWidth||sh!==outputHeight) {
      // Keep native-density rendering, but transfer only the CPU interface's
      // logical pixels. This also covers loading art in race-sized surfaces.
      if(!readSurface||readWidth!==sw||readHeight!==sh){
        readSurface?.destroy();readWidth=sw;readHeight=sh;
        readSurface=device.createTexture({size:[sw,sh],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
        device.queue.writeBuffer(readExtent,0,Uint32Array.of(sw,sh));
        readGroup=device.createBindGroup({layout:readPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:colorView},{binding:1,resource:{buffer:readExtent}}]});
      }
      const pass=encoder.beginRenderPass({colorAttachments:[{view:readSurface.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
      pass.setPipeline(readPipeline);pass.setBindGroup(0,readGroup);pass.draw(3);pass.end();sourceTexture=readSurface;
    }
    const size=stride*h;
    let entry=size<=65536?readBuffers.find(e=>!e.busy&&e.size>=size):null;
    if(!entry){
      entry={buffer:device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),size,busy:false,pooled:size<=65536&&readBuffers.length<4};
      stats.readbackAllocations++;if(entry.pooled)readBuffers.push(entry);
    }
    entry.busy=true;const buffer=entry.buffer;
    encoder.copyTextureToBuffer({ texture: sourceTexture,origin:[x,y,0] }, { buffer, bytesPerRow: stride, rowsPerImage: h }, [w,h]);
    device.queue.submit([encoder.finish()]);
    stats.submissions++;
    try {
      const started=performance.now();await buffer.mapAsync(GPUMapMode.READ);stats.readbackWaitMs+=performance.now()-started;
      const source = new Uint8Array(buffer.getMappedRange()), pixels = new Uint8Array(w*h*4);
      for (let row = 0; row < h; row++) pixels.set(source.subarray(row*stride,row*stride+w*4),row*w*4);
      stats.readbackBytes+=pixels.length;stats.readbackBufferBytes+=stride*h;
      check(); return pixels;
    } finally {if(!entry.pooled||closed)buffer.destroy();else{buffer.unmap();entry.busy=false;}}
  }
  textureCreate(0,1,1,Uint8Array.of(255,255,255,255)); resize(canvas.width || 640, canvas.height || 480);
  return {
    resize, clear, draw, present, frameBudget, flush, flushHint, textureCreate, textureUpdate, textureDestroy, readPixels, reset, stats, errors, timing, resetTiming,
    info: { vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,device:adapter.info?.device,description:adapter.info?.description,software:Boolean(adapter.info?.isFallbackAdapter??adapter.isFallbackAdapter),maxTextureSize:device.limits.maxTextureDimension2D,depthFormat },
    get width() { return width; }, get height() { return height; },
    get outputWidth(){return outputWidth;},get outputHeight(){return outputHeight;},
    async validate() { await device.queue.onSubmittedWorkDone(); check(); },
    close() { if (closed) return; closed = true; for (const entry of textures.values()) entry.texture.destroy();for(const entry of readBuffers)entry.buffer.destroy(); color.destroy(); depth.destroy();readSurface?.destroy();readExtent.destroy(); vertexBuffer?.destroy(); indexBuffer?.destroy(); uniformBuffer?.destroy(); context.unconfigure(); device.destroy(); },
  };
}
