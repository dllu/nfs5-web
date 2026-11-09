/* Single-consumer command transport. Producers hold the guest machine lock;
 * the application Worker consumes snapshots without entering the guest CPU. */
#ifndef NFS5_WEB_GPU_H
#define NFS5_WEB_GPU_H
#include <emscripten/threading.h>
#include <limits.h>
#define GPU_QUEUE_WORDS (1u << 22)
typedef struct { float x,y,z,rhw; uint32_t color,specular; float u,v; } nfspu_gpu_vertex;
typedef struct {
    uint32_t texture,depth_test,depth_write,blend_enable,src_blend,dst_blend,filter_linear,address_wrap,cull;
    uint32_t alpha_test,alpha_ref,fog_enable,fog_color;
    float fog_near,fog_far;
    uint32_t primitive,depth_func,scissor_enable,scissor_x,scissor_y,scissor_w,scissor_h,alpha_modulate,fog_mode;
    float fog_density;
} nfspu_gpu_state;
_Static_assert(sizeof(nfspu_gpu_vertex) == 32, "Thrash vertex ABI");
_Static_assert(sizeof(nfspu_gpu_state) == 100, "GPU state ABI");
enum { GPU_RESIZE=1, GPU_CLEAR, GPU_PRESENT, GPU_DRAW, GPU_TEXTURE_CREATE, GPU_TEXTURE_WRITE,
       GPU_TEXTURE_DESTROY, GPU_READ_PIXELS, GPU_FLUSH, GPU_RESET };
static struct {
    _Atomic uint32_t write,read,completed,attached,failed;
    uint32_t capacity,version,sequence;
    uint32_t words[GPU_QUEUE_WORDS];
} gpu_transport;
static char gpu_error[256];
static uint32_t gpu_width,gpu_height,gpu_next_texture;
static struct { uint32_t id,width,height; } gpu_textures[8192];
static void gpu_wake_waiters(void) {
    emscripten_futex_wake(&gpu_transport.read,INT_MAX);
    emscripten_futex_wake(&gpu_transport.completed,INT_MAX);
}
static void gpu_park(_Atomic uint32_t *word,uint32_t value) {
    machine_release();
    /* The bounded wait also handles older consumers without acknowledgement
     * notifications. Stop and renderer failures explicitly wake both words. */
    emscripten_futex_wait(word,value,10);
    machine_acquire();machine_abort_check();
}

static void gpu_check(void) {
    if (atomic_load(&gpu_transport.failed)) fail(g_cur_func, "WebGPU: %s", gpu_error);
    if (!atomic_load(&gpu_transport.attached)) fail(g_cur_func, "WebGPU renderer is not attached");
    if (emscripten_get_now() > deadline) fail(g_cur_func, "Graphics wait budget reached at %08X", g_cur_func);
}
static void gpu_wait(uint32_t sequence) {
    for(;;) {
        uint32_t completed=atomic_load(&gpu_transport.completed);
        if((int32_t)(completed-sequence)>=0)break;
        gpu_check();gpu_park(&gpu_transport.completed,completed);
    }
    gpu_check();
}
static void gpu_copy(uint32_t *cursor, const void *bytes, uint32_t length) {
    if (!length) return;
    uint32_t at = *cursor & (GPU_QUEUE_WORDS - 1), count = length / 4;
    uint32_t first = count < GPU_QUEUE_WORDS - at ? count : GPU_QUEUE_WORDS - at;
    memcpy(gpu_transport.words + at, bytes, first * 4);
    if (first < count) memcpy(gpu_transport.words, (const uint8_t *)bytes + first * 4, (count - first) * 4);
    *cursor += count;
}
static uint32_t gpu_send(uint32_t opcode, const void *a, uint32_t an, const void *b, uint32_t bn, const void *c, uint32_t cn) {
    gpu_check();
    uint64_t bytes = (uint64_t)an + bn + cn;
    if ((bytes & 3) || bytes / 4 + 3 >= GPU_QUEUE_WORDS) fail(g_cur_func, "Graphics command too large (%llu bytes)", (unsigned long long)bytes);
    uint32_t count = (uint32_t)(bytes / 4) + 3;
    for(;;) {
        uint32_t read=atomic_load(&gpu_transport.read);
        if(GPU_QUEUE_WORDS-(uint32_t)(atomic_load(&gpu_transport.write)-read)>=count)break;
        gpu_park(&gpu_transport.read,read);gpu_check();
    }
    uint32_t cursor = atomic_load(&gpu_transport.write), sequence = ++gpu_transport.sequence;
    uint32_t header[] = {count,opcode,sequence};
    gpu_copy(&cursor,header,12); gpu_copy(&cursor,a,an); gpu_copy(&cursor,b,bn); gpu_copy(&cursor,c,cn);
    atomic_store(&gpu_transport.write,cursor);
    emscripten_futex_wake(&gpu_transport.write,1);
    return sequence;
}
static int gpu_resize(uint32_t width,uint32_t height) {
    uint32_t size[] = {width,height}; gpu_wait(gpu_send(GPU_RESIZE,size,8,NULL,0,NULL,0));
    gpu_width=width;gpu_height=height;return 1;
}
static int gpu_open(uint32_t width,uint32_t height) { return gpu_resize(width,height); }
static void gpu_clear(uint32_t color,float depth) {
    uint32_t args[2] = {color,0}; memcpy(args+1,&depth,4); gpu_send(GPU_CLEAR,args,8,NULL,0,NULL,0);
}
static int gpu_present(void) { gpu_wait(gpu_send(GPU_PRESENT,NULL,0,NULL,0,NULL,0)); return 1; }
static int gpu_flush(void) { gpu_wait(gpu_send(GPU_FLUSH,NULL,0,NULL,0,NULL,0)); return 1; }
static int gpu_texture_write(uint32_t id,const uint8_t *rgba) {
    unsigned slot;
    for(slot=0;slot<8192;slot++)if(gpu_textures[slot].id==id)break;
    if(slot==8192)return 0;
    uint32_t size=gpu_textures[slot].width*gpu_textures[slot].height*4;
    for(uint32_t offset=0;offset<size;) {
        uint32_t n=size-offset;if(n>1024*1024)n=1024*1024;
        uint32_t args[]={id,offset,n,size};
        gpu_send(GPU_TEXTURE_WRITE,args,16,rgba+offset,n,NULL,0);offset+=n;
    }
    return 1;
}
static uint32_t gpu_texture_create(uint32_t width,uint32_t height,const uint8_t *rgba) {
    unsigned slot;for(slot=0;slot<8192&&gpu_textures[slot].id;slot++);
    if(slot==8192)return 0;
    uint32_t id=++gpu_next_texture;if(!id)fail(g_cur_func,"GPU texture IDs exhausted");
    gpu_textures[slot].id=id;gpu_textures[slot].width=width;gpu_textures[slot].height=height;
    uint32_t args[]={id,width,height};gpu_send(GPU_TEXTURE_CREATE,args,12,NULL,0,NULL,0);
    if(rgba)gpu_texture_write(id,rgba);return id;
}
static void gpu_texture_destroy(uint32_t id) {
    for(unsigned i=0;i<8192;i++)if(gpu_textures[i].id==id){gpu_textures[i].id=0;break;}
    gpu_send(GPU_TEXTURE_DESTROY,&id,4,NULL,0,NULL,0);
}
static int gpu_draw(const nfspu_gpu_vertex *vertices,uint32_t count,const uint32_t *indices,uint32_t index_count,const nfspu_gpu_state *state) {
    struct {nfspu_gpu_state state;uint32_t count,indices;} args={*state,count,index_count};
    gpu_send(GPU_DRAW,&args,sizeof args,vertices,count*32,indices,index_count*4);return 1;
}
static int gpu_read_pixels(uint8_t *rgba,uint32_t width,uint32_t height) {
    if(width!=gpu_width||height!=gpu_height)return 0;
    uint32_t args[]={(uint32_t)(uintptr_t)rgba,width,height};
    gpu_wait(gpu_send(GPU_READ_PIXELS,args,12,NULL,0,NULL,0));return 1;
}
static void gpu_close(void) {
    gpu_wait(gpu_send(GPU_RESET,NULL,0,NULL,0,NULL,0));memset(gpu_textures,0,sizeof gpu_textures);
}
static const struct {
    int (*open)(uint32_t,uint32_t);void(*close)(void);int(*resize)(uint32_t,uint32_t);
    void(*clear)(uint32_t,float);int(*present)(void);
    uint32_t(*texture_create)(uint32_t,uint32_t,const uint8_t*);int(*texture_update)(uint32_t,const uint8_t*);void(*texture_destroy)(uint32_t);
    int(*draw)(const nfspu_gpu_vertex*,uint32_t,const uint32_t*,uint32_t,const nfspu_gpu_state*);
    int(*read_pixels)(uint8_t*,uint32_t,uint32_t);
} web_gpu_api={gpu_open,gpu_close,gpu_resize,gpu_clear,gpu_present,gpu_texture_create,gpu_texture_write,gpu_texture_destroy,gpu_draw,gpu_read_pixels};
static void gpu_reset(void) {
    memset(&gpu_transport,0,sizeof gpu_transport);gpu_transport.capacity=GPU_QUEUE_WORDS;gpu_transport.version=2;
    memset(gpu_textures,0,sizeof gpu_textures);gpu_width=gpu_height=gpu_next_texture=0;gpu_error[0]=0;
}
#endif
