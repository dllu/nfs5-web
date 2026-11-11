// The supplied patch's NoMovies option skips the opening helper. The original
// recompiled helper preserves the native patch's jump and stack effects,
// avoiding runtime modification of translated code.
export const verokImage='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906';
export function openingMovies(bytes) {
  if(!bytes)return true;
  const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===239&&bytes[1]===187&&bytes[2]===191?'utf-8':'windows-1252';
  let section='',enabled=true;
  for(const raw of new TextDecoder(encoding).decode(bytes).split(/\r?\n/)) {
    const line=raw.trim();if(!line||line[0]===';'||line[0]==='#')continue;
    const header=/^\[([^\]]+)\]/.exec(line);
    if(header){section=header[1].trim().toLowerCase();continue;}
    const pair=/^([^=]+)=(.*)$/.exec(line);
    if(section==='nfs5'&&pair&&pair[1].trim().toLowerCase()==='nomovies') {
      const value=pair[2].trim().replace(/^"(.*)"$/,'$1');enabled=!(Number.parseInt(value,10)||0);
    }
  }
  return enabled;
}

// Software WebGPU adapters can enqueue frames faster than the CPU rasterizer
// completes them. Bound the default race mode's pixel count, preserving aspect
// and the game's minimum display size. Explicit saved race modes stay intact.
export function softwareViewport(display, pixelLimit, maxDimension=16384) {
  if(!display||!pixelLimit)return display;
  const {width,height}=display;
  const scale=Math.min(maxDimension/Math.max(width,height),
    Math.max(Math.min(1,Math.sqrt(pixelLimit/(width*height))),640/width,480/height));
  return {width:Math.max(640,Math.floor(width*scale)),height:Math.max(480,Math.floor(height*scale))};
}

// This browser preference leaves the career's original graphics settings intact.
export function sceneDetail(value) {
  return ['auto','original','far','very-far'].includes(value)?value:'auto';
}
export function savedSceneDetail(storage) {
  try{return sceneDetail((storage??globalThis.localStorage)?.getItem('nfs5-scene-detail'));}catch{return 'auto';}
}
export function sceneDetailMode(value,{touch=false,software=false}={}) {
  value=sceneDetail(value);
  return value==='very-far'?2:value==='far'?1:value==='original'||touch||software?0:1;
}

export function touchViewport({width,height},pixelLimit) {
  // A distinct 4:3 mode keeps the race controls active on small viewports
  // where the minimum mode would otherwise match the 640×480 frontend.
  const unit=Math.max(161,Math.floor(Math.min(width/4,height/3,Math.sqrt(pixelLimit/12))));
  return {width:unit*4,height:unit*3};
}

export function savedSkyboxes() {
  try{return globalThis.localStorage?.getItem('nfs5-skyboxes')==='atmospheric';}catch{return false;}
}
