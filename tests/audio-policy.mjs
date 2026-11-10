import assert from 'node:assert/strict';
import {openAudio} from '../web/audio.mjs';
let session={type:'ambient',state:'active'},created,fail=false;
globalThis.navigator={get audioSession(){return session;}};
globalThis.AudioContext=class {
 constructor(){created=this;this.typeAtCreation=session?.type;this.sampleRate=48000;this.state='suspended';this.destination={};this.audioWorklet={addModule:async()=>{if(fail)throw new Error('Worklet failed');}};}
 async resume(){this.state='running';}
 async close(){this.state='closed';}
};
globalThis.AudioWorkletNode=class {constructor(){this.port={postMessage(){}};}connect(){}disconnect(){}};
const audio=await openAudio();assert.equal(created.typeAtCreation,'playback','Select the media route before constructing the context');
assert.equal(audio.stats().sessionType,'playback');assert.equal(audio.stats().state,'running');assert.equal(audio.stats().rate,48000);
created.state='interrupted';assert.equal(audio.stats().state,'interrupted');await audio.resume();assert.equal(audio.stats().state,'running');
await audio.close();assert.equal(session.type,'ambient','Closing restores the previous session type');
session={type:'auto'};fail=true;await assert.rejects(openAudio(),/Worklet failed/);assert.equal(created.state,'closed');assert.equal(session.type,'auto');
fail=false;session=undefined;const absent=await openAudio();assert.equal(absent.stats().sessionType,null);await absent.close();
session={get type(){return 'ambient';},set type(value){throw new Error('Unsupported session policy');}};
const unsupported=await openAudio();assert.equal(unsupported.stats().state,'running');await unsupported.close();
console.log('Playback audio session, context/level diagnostics, resume, cleanup and unavailable/rejected policy fallback passed');
