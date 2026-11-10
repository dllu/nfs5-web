// Choose continuous native joystick axes or separate virtual arrow keys.
export function attachControls(input,{onDiagnostics=()=>{}}={}) {
  let layout='joystick';
  try{if(localStorage.getItem('nfs5-touch-layout')==='buttons')layout='buttons';}catch{}
  const root=document.createElement('div');root.id='controls';
  root.innerHTML=`<nav id="game-tools" aria-label="Game controls">
    <button id="pause-game" type="button">Pause</button>
    <button id="toggle-pad" type="button" aria-pressed="false">Controls</button>
    <button id="touch-layout" type="button" hidden>Layout: Joystick</button>
    <button id="show-keyboard" type="button">Keyboard</button>
    <button id="show-info" type="button">Info</button>
  </nav>
  <div id="touch-pad" hidden><div id="joystick" role="group" aria-label="Steer and accelerate"><span></span></div>
    <div id="steering-buttons" role="group" aria-label="Steering" hidden><button data-scan="203" aria-label="Steer left">◀</button><button data-scan="205" aria-label="Steer right">▶</button></div>
    <div id="pedals"><button id="gas" data-scan="200"><span aria-hidden="true">▲</span> Gas</button><button id="brake" data-scan="208"><span aria-hidden="true">▼</span> Brake</button><button id="handbrake" data-scan="57">Handbrake</button><button id="camera" data-pulse="46">Camera</button></div></div>
  <form id="game-keyboard" hidden><input aria-label="Type player name" placeholder="Type player name" autocomplete="off" autocapitalize="off" spellcheck="false"><button>Enter</button></form>
  <section id="game-info" hidden><button id="close-info">Close</button><button id="copy-info">Copy diagnostics</button><p>Exit through the game's Quit to Windows option to save career progress. Profiles stay in this browser.</p><pre></pre></section>`;
  document.body.append(root);
  const find=id=>root.querySelector('#'+id),pad=find('touch-pad'),joystick=find('joystick'),knob=joystick.firstElementChild;
  const releaseButtons=[];
  let manual=null,racing=false,coarse=matchMedia('(pointer: coarse)'),stickPointer=null,textQueue=Promise.resolve(),closed=false;
  function update(){const show=manual??(coarse.matches&&racing);pad.hidden=!show;find('touch-layout').hidden=!show;find('toggle-pad').setAttribute('aria-pressed',String(show));if(!show)blur();}
  function setLayout(next){
    blur();layout=next;pad.dataset.layout=layout;
    joystick.hidden=layout==='buttons';find('steering-buttons').hidden=layout!=='buttons';
    find('touch-layout').textContent='Layout: '+(layout==='buttons'?'Buttons':'Joystick');
    find('touch-layout').title='Switch to '+(layout==='buttons'?'joystick':'button')+' controls';
  }
  function releaseStick(){stickPointer=null;knob.style.transform='';input.analog(0,0,false);}
  function stick(event) {
    if(event.type==='pointerdown'){if(stickPointer!==null)return;stickPointer=event.pointerId;joystick.setPointerCapture(event.pointerId);}
    if(event.pointerId!==stickPointer)return;event.preventDefault();
    if(['pointerup','pointercancel','lostpointercapture'].includes(event.type)){releaseStick();return;}
    const box=joystick.getBoundingClientRect(),radius=box.width/2;
    let x=(event.clientX-box.left-radius)/radius,y=(event.clientY-box.top-radius)/radius;
    const distance=Math.hypot(x,y);if(distance>1){x/=distance;y/=distance;}
    knob.style.transform=`translate(${x*radius*.65}px,${y*radius*.65}px)`;
    const axis=value=>Math.abs(value)<.06?0:Math.sign(value)*(Math.abs(value)-.06)/.94;
    input.analog(axis(x),-axis(y));
  }
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])joystick.addEventListener(type,stick);
  for(const button of root.querySelectorAll('[data-scan]')) {
    const pointers=new Set(),scan=Number(button.dataset.scan);
    const release=()=>{pointers.clear();input.key(scan,false,button);button.classList.remove('pressed');};releaseButtons.push(release);
    button.addEventListener('pointerdown',event=>{event.preventDefault();pointers.add(event.pointerId);button.setPointerCapture(event.pointerId);input.key(scan,true,button);button.classList.add('pressed');});
    const up=event=>{pointers.delete(event.pointerId);if(!pointers.size)release();};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,up);
  }
  for(const b of root.querySelectorAll('[data-pulse]'))b.onclick=()=>input.pulse(Number(b.dataset.pulse));
  find('pause-game').onclick=()=>input.pulse(1);
  find('toggle-pad').onclick=()=>{manual=pad.hidden;update();};
  find('touch-layout').onclick=()=>{setLayout(layout==='buttons'?'joystick':'buttons');try{localStorage.setItem('nfs5-touch-layout',layout);}catch{}};
  coarse.addEventListener('change',update);
  const form=find('game-keyboard'),field=form.querySelector('input');
  find('show-keyboard').onclick=()=>{form.hidden=!form.hidden;if(!form.hidden)field.focus();};
  const letters=[30,48,46,32,18,33,34,35,23,36,37,38,50,49,24,25,16,19,31,20,22,47,17,45,21,44];
  function type(text) {
    textQueue=textQueue.then(async()=>{
      for(const char of text) {
        if(closed)return;
        const lower=char.toLowerCase(),scan=char==='\b'?14:char==='\n'?28:char===' '?57:char==='-'?12:char==='.'?52:/^[a-z]$/.test(lower)?letters[lower.charCodeAt(0)-97]:/^[0-9]$/.test(char)?char==='0'?11:Number(char)+1:0;
        if(!scan)continue;
        const shift=/^[A-Z]$/.test(char);if(shift)input.key(42,true,'text');
        input.key(scan,true,'text');await new Promise(r=>setTimeout(r,100));input.key(scan,false,'text');input.key(42,false,'text');await new Promise(r=>setTimeout(r,35));
      }
    });
  }
  field.addEventListener('input',event=>{if(event.isComposing)return;type(field.value);field.value='';});
  field.addEventListener('beforeinput',event=>{if(event.inputType==='deleteContentBackward'){event.preventDefault();type('\b');}});
  form.onsubmit=event=>{event.preventDefault();type('\n');field.blur();form.hidden=true;};
  find('show-info').onclick=()=>{find('game-info').hidden=false;onDiagnostics();};
  find('close-info').onclick=()=>{find('game-info').hidden=true;};
  find('copy-info').onclick=async()=>{try{await navigator.clipboard.writeText(find('game-info').querySelector('pre').textContent);find('copy-info').textContent='Copied';}catch{find('copy-info').textContent='Select and copy the text below';}};
  function blur(){releaseStick();releaseButtons.forEach(release=>release());}
  window.addEventListener('blur',blur);setLayout(layout);update();
  return {
    setScreen({width,height}){racing=width!==640||height!==480;update();},
    diagnostics(data){find('game-info').querySelector('pre').textContent=JSON.stringify({browser:navigator.userAgent,...data},null,2);},
    close(){closed=true;blur();coarse.removeEventListener('change',update);window.removeEventListener('blur',blur);root.remove();},
  };
}
