// Worker animation callbacks can stop when their owning window is obscured,
// even without a visibility event. Always retain an independent deadline.
export function framePacer({now=()=>performance.now(),frame=globalThis.requestAnimationFrame?.bind(globalThis),cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis),wait}={}) {
  const clock=new Int32Array(new SharedArrayBuffer(4));
  wait??=(milliseconds,done)=>{
    if(typeof Atomics.waitAsync==='function'){
      const pending=Atomics.waitAsync(clock,0,Atomics.load(clock,0),milliseconds);
      Promise.resolve(pending.value).then(done);
      return ()=>{Atomics.add(clock,0,1);Atomics.notify(clock,0);};
    }
    const timer=setTimeout(done,milliseconds);return ()=>clearTimeout(timer);
  };
  let visible=true,focused=true,menu=true,last=0,cancel;
  const stats={animationTimeouts:0,backgroundFrames:0};
  return {
    stats,
    setState(state){visible=state.visible??visible;focused=state.focused??focused;menu=state.menu??menu;last=0;cancel?.();},
    close(){cancel?.();},
    next(){return new Promise(resolve=>{
      const active=visible&&focused,minimum=active?(menu?1000/60:0):1000/30;
      const due=last?last+minimum:now()+minimum;
      let animation,stopWait,finished=false;
      const done=()=>{if(finished)return;finished=true;if(animation!==undefined)cancelFrame?.(animation);stopWait?.();cancel=null;last=now();resolve();};
      cancel=done;
      if(active&&frame){
        const animate=()=>{if(finished)return;if(now()+.2<due)animation=frame(animate);else done();};
        animation=frame(animate);
        stopWait=wait(Math.max(100,due-now()),()=>{if(!finished){stats.animationTimeouts++;done();}});
      }else{
        if(!active)stats.backgroundFrames++;
        stopWait=wait(Math.max(0,due-now()),done);
      }
    });},
  };
}
