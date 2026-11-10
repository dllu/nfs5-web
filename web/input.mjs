// Physical PC set-1/DirectInput scan codes, independent of keyboard layout.
const scans = {
  Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05,
  Digit5: 0x06, Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b,
  Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15,
  KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1a, BracketRight: 0x1b,
  Enter: 0x1c, ControlLeft: 0x1d, KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21,
  KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26,
  Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2a, Backslash: 0x2b,
  KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32,
  Comma: 0x33, Period: 0x34, Slash: 0x35, ShiftRight: 0x36,
  NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3a,
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40,
  F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, NumLock: 0x45, ScrollLock: 0x46,
  Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4a,
  Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d, NumpadAdd: 0x4e,
  Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52, NumpadDecimal: 0x53,
  IntlBackslash: 0x56, F11: 0x57, F12: 0x58, NumpadEnter: 0x9c,
  ControlRight: 0x9d, NumpadDivide: 0xb5, PrintScreen: 0xb7, AltRight: 0xb8,
  Pause: 0xc5, Home: 0xc7, ArrowUp: 0xc8, PageUp: 0xc9,
  ArrowLeft: 0xcb, ArrowRight: 0xcd, End: 0xcf, ArrowDown: 0xd0, PageDown: 0xd1,
  Insert: 0xd2, Delete: 0xd3, MetaLeft: 0xdb, MetaRight: 0xdc, ContextMenu: 0xdd,
};

export function attachInput(target, send, {viewport=target,keepRunningOnBlur=false}={}) {
  const handlers=[],keys=new Map(),releaseTimers=new Map(),pressedAt=new Map();
  let buttons=0,touchId=null,lastPoint={x:0,y:0},touchStart=0,touchTimer;
  function listen(object,type,handler,options) {
    object.addEventListener(type,handler,options);
    handlers.push(()=>object.removeEventListener(type,handler,options));
  }
  function key(scan,down,source='virtual') {
    const sources=keys.get(scan)??new Set(),was=sources.size>0;
    if(down)sources.add(source);else sources.delete(source);
    if(sources.size)keys.set(scan,sources);else keys.delete(scan);
    if(was!==(sources.size>0))send({type:'input',key:scan,down:sources.size>0});
  }
  function pulse(scan,duration=150) {
    const source=Symbol();key(scan,true,source);
    const timer=setTimeout(()=>{releaseTimers.delete(source);key(scan,false,source);},duration);
    releaseTimers.set(source,timer);
  }
  function keyboard(event) {
    const editing=event.target?.closest?.('input,textarea,[contenteditable="true"]');
    if(editing&&event.type==='keydown')return;
    const scan=scans[event.code]??(event.key==='Escape'?1:undefined);
    if(!scan)return;
    if(!editing)event.preventDefault();
    if(event.type==='keydown') {
      clearTimeout(releaseTimers.get(scan));releaseTimers.delete(scan);
      if(!event.repeat)pressedAt.set(scan,performance.now());
      if(scan!==1||!event.repeat)key(scan,true,'keyboard');
    } else {
      const delay=scan===1?Math.max(0,150-(performance.now()-(pressedAt.get(scan)??0))):0;
      if(delay)releaseTimers.set(scan,setTimeout(()=>{releaseTimers.delete(scan);key(scan,false,'keyboard');},delay));
      else key(scan,false,'keyboard');
    }
  }
  function mouse(event,dz=0) {
    buttons=event.buttons??0;lastPoint={x:event.clientX,y:event.clientY};
    send({type:'input',dx:event.movementX||0,dy:event.movementY||0,dz,buttons,...lastPoint});
  }
  function release() {
    analog(0,0,false);
    for(const timer of releaseTimers.values())clearTimeout(timer);
    releaseTimers.clear();clearTimeout(touchTimer);
    for(const scan of keys.keys())send({type:'input',key:scan,down:false});
    keys.clear();pressedAt.clear();buttons=0;touchId=null;
    send({type:'input',dx:0,dy:0,dz:0,buttons:0,...lastPoint});
  }
  listen(target,'keydown',keyboard);listen(target,'keyup',keyboard);
  listen(target,'blur',()=>{release();if(!keepRunningOnBlur)send({type:'input',focus:false});});
  listen(target,'focus',()=>send({type:'input',focus:true}));
  listen(viewport,'mousemove',event=>mouse(event));
  listen(viewport,'mousedown',event=>mouse(event));
  // Preserve mouse-up outside the canvas without forwarding overlay clicks.
  listen(target,'mouseup',event=>{if(buttons||viewport===target||event.target===viewport)mouse(event);});
  listen(viewport,'wheel',event=>{event.preventDefault();mouse(event,-Math.sign(event.deltaY)*120);},{passive:false});
  listen(viewport,'contextmenu',event=>event.preventDefault());
  function touch(event) {
    if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
    event.preventDefault();
    if(event.type==='pointerdown') {
      if(touchId!==null)return;
      if(buttons)send({type:'input',dx:0,dy:0,dz:0,buttons:0,...lastPoint});
      clearTimeout(touchTimer);touchId=event.pointerId;touchStart=performance.now();
      viewport.setPointerCapture?.(touchId);buttons=1;
    } else if(event.pointerId!==touchId)return;
    lastPoint={x:event.clientX,y:event.clientY};
    if(event.type==='pointerup'||event.type==='pointercancel') {
      touchId=null;
      touchTimer=setTimeout(()=>{buttons=0;send({type:'input',dx:0,dy:0,dz:0,buttons:0,...lastPoint});},Math.max(0,120-(performance.now()-touchStart)));
    } else send({type:'input',dx:0,dy:0,dz:0,buttons:1,...lastPoint});
  }
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])listen(viewport,type,touch,{passive:false});
  const detach=()=>{handlers.forEach(remove=>remove());release();send({type:'input',focus:false});};
  function analog(steer,pedal=0,active=true){send({type:'input',steer,pedal,analog:active});}
  Object.assign(detach,{key,pulse,release,analog});return detach;
}
