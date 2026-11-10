#ifndef NFS5_WEB_AUDIO_H
#define NFS5_WEB_AUDIO_H
#include <stddef.h>
static struct { _Atomic uint32_t state[8];float samples[4096*2]; } audio_queue;
_Static_assert(offsetof(__typeof__(audio_queue),samples)==32,"AudioWorklet ring layout");
static _Atomic uint32_t audio_rate;
// The VM owner mixes before releasing its lock. Graphics never waits for a
// sound refill to acquire the VM; an idle host tick only tries the lock.
static void audio_produce(void) {
    uint32_t rate=atomic_load(&audio_rate);if(!rate||!atomic_load(&audio_queue.state[5]))return;
    if(fatal_pending||process_exited||cancel_workers)return;
    uint32_t read=atomic_load(&audio_queue.state[0]),write=atomic_load(&audio_queue.state[1]),queued=write-read;
    if(queued>=1024)return;
    float mixed[512*2];uint32_t remaining=1024-queued;
    while(remaining){
        uint32_t count=remaining>512?512:remaining,at=write&4095,first=count<4096-at?count:4096-at;
        ds_mix(mixed,count,rate);
        memcpy(audio_queue.samples+at*2,mixed,first*2*sizeof(float));
        if(first<count)memcpy(audio_queue.samples,mixed+first*2,(count-first)*2*sizeof(float));
        write+=count;atomic_store(&audio_queue.state[1],write);remaining-=count;
        atomic_fetch_add(&audio_queue.state[7],1);
    }
}
static void audio_reset(void){atomic_store(&audio_rate,0);atomic_store(&audio_queue.state[5],0);}
uint32_t web_audio_start(uint32_t rate) {
    if(rate<8000||rate>192000)return 0;
    machine_acquire();atomic_store(&audio_rate,0);
    for(unsigned i=0;i<8;i++)atomic_store(&audio_queue.state[i],0);
    atomic_store(&audio_queue.state[5],1);atomic_store(&audio_rate,rate);
    machine_release();return (uint32_t)(uintptr_t)&audio_queue;
}
uint32_t web_audio_tick(void) {
    if(!atomic_load(&audio_rate))return 1;
    if(pthread_mutex_trylock(&machine_mutex)){atomic_fetch_add(&audio_queue.state[6],1);return 0;}
    cpu_load();machine_held=1;machine_release();return 1;
}
void web_audio_stop(void){machine_acquire();audio_reset();machine_release();}
#endif
