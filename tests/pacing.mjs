import assert from 'node:assert/strict';
import {framePacer} from '../web/pacing.mjs';
let time=0,nextId=0,callbacks=new Map(),animations=true;
const schedule=(delay,fn)=>{const id=++nextId;callbacks.set(id,{at:time+delay,fn});return id;};
const pacer=framePacer({now:()=>time,frame:fn=>animations?schedule(6,fn):++nextId,
 cancelFrame:id=>callbacks.delete(id),wait:(ms,fn)=>{const id=schedule(ms,fn);return ()=>callbacks.delete(id);}});
async function next(){
 const started=time;let done=false;const pending=pacer.next().then(()=>done=true);
 for(let i=0;i<50&&!done;i++){
  assert(callbacks.size,'Pacing must retain a wakeup');
  const [id,task]=[...callbacks].sort((a,b)=>a[1].at-b[1].at)[0];callbacks.delete(id);time=task.at;task.fn();await Promise.resolve();
 }
 assert(done);await pending;assert.equal(callbacks.size,0,'Each frame cancels its unused clock');return time-started;
}
assert((await next())>=1000/60,'Menus must not run at the full high-refresh display rate');
pacer.setState({menu:false});assert.equal(await next(),6,'Races follow the display without a 60 Hz cap');
animations=false;assert.equal(await next(),100,'Missing animation callbacks have a bounded fallback');assert.equal(pacer.stats.animationTimeouts,1);
pacer.setState({focused:false});assert(Math.abs(await next()-1000/30)<.01,'An unfocused but visible window uses the independent background clock');
pacer.setState({visible:false,focused:true});assert(Math.abs(await next()-1000/30)<.01);
animations=true;pacer.setState({visible:true});assert.equal(await next(),6);
const canceled=pacer.next();pacer.setState({focused:false});await canceled;assert.equal(callbacks.size,0);
const closed=pacer.next();pacer.close();await closed;assert.equal(callbacks.size,0);
console.log('High-refresh menu limit, uncapped race pacing, missing-rAF watchdog, focus/visibility transitions and cancellation passed');
