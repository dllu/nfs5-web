/* Thrash ABI and pixel conversion adapted from nfspu-recomp/src/host/thrash.c.
 * MIT, copyright 2026 Sergei Biriukov; license retained in the pinned submodule.
 * The browser transport replaces its native SDL backend and input plumbing. */
#ifndef NFS5_THRASH_DRIVER_H
#define NFS5_THRASH_DRIVER_H
#include "thrash_config.h"
#define THRASH_MODULE 0x7A000001u
#define MAX_TEXTURES 8192
static const uint32_t mode_sizes[][2]={{640,480},{800,600},{1024,768},{1280,720},{1280,960},{1600,1200},{1920,1080},{960,720},{1600,900},{2560,1440},{3840,2160},{5120,2880},{6144,3456},{320,240}};
enum {MODE_RESOLUTIONS=sizeof mode_sizes/sizeof mode_sizes[0],VIEWPORT_MODE=MODE_RESOLUTIONS*2+1,MODE_COUNT=VIEWPORT_MODE+1};
static const __typeof__(web_gpu_api) *gpu=&web_gpu_api;
static uint32_t descriptor,modes,formats,framebuffer,framebuffer_capacity,lockdesc,surface_info,callbacks;
static uint32_t width=640,height=480,color_bits=16;
static uint32_t window_color_clear=1;
static int opened,trace;
static uint32_t state_values[8][1024],clear_color=0xFF000000u;
static float clear_depth=1,vertex_depth_bias;
static uint32_t selected_fog_mode;
static nfspu_gpu_state render_state;
static unsigned frames,draws,uploads,software_frames,partial_clears;
static uint32_t vertex_stride=32,sprite_stride=32,thrash_calls;
static uint32_t thrash_version=107;
/* Native states 404/405 use a compact enum, unlike the backend's blend enum:
 * ONE, ZERO, SRC_ALPHA, 1-SRC_ALPHA, DST_ALPHA, 1-DST_ALPHA,
 * SRC_COLOR, DST_COLOR, 1-SRC_COLOR, 1-DST_COLOR. */
static const uint32_t native_blend_factors[]={2,1,5,6,7,8,3,9,4,10};
typedef struct {uint32_t va,gpu_id,width,height,format,mip_levels;uint8_t *pixels;uint32_t *palette;} texture_slot;
static texture_slot textures[MAX_TEXTURES];
static float as_float(uint32_t value){float f;memcpy(&f,&value,4);return f;}
static void *th_guest_alloc(uint32_t n){return (void*)ADDR(allocate(n));}
static uint32_t th_guest_va(const void *p){return p?(uint32_t)((uintptr_t)p-(uintptr_t)g_mem_base):0;}
static void th_guest_free(void *p){guest_block *block=find_block(th_guest_va(p),1);if(block)release_block(block);}
static uint32_t th_guest_string(const char *text){uint32_t p=allocate((uint32_t)strlen(text)+1);strcpy((char*)ADDR(p),text);return p;}
static void nfspu_thrash_pump(void){machine_yield();}
static int open_gpu(void){if(!opened){if(!gpu->open(width,height))return 0;opened=1;}return 1;}
static void hle_set_screen_size(uint32_t w,uint32_t h){win_render_size(w,h);}
static void nfspu_thrash_shutdown(void){if(opened){gpu->close();opened=0;for(unsigned i=0;i<MAX_TEXTURES;i++)textures[i].gpu_id=0;render_state.texture=0;}}
#define RET(value,argc) do {result((uint32_t)(value),(argc));return;}while(0)
#define A32(i) argument(i)
#define APTR(i) ((void*)ADDR(argument(i)))
#define hle_ptr(va) ((void*)ADDR(va))
#define hle_va(p) th_guest_va(p)
#define hle_alloc(n) th_guest_alloc(n)
#define hle_free(p) th_guest_free(p)
#define hle_guest_strdup(p) th_guest_string(p)
#define hle_call_guest(address,count,args) guest_callback(address,count,args)
#define hle_fatal(...) fail(g_cur_func,__VA_ARGS__)
static texture_slot *find_texture(uint32_t va) {
    for(int i=0;i<MAX_TEXTURES;i++)if(textures[i].va==va && va)return &textures[i];
    return NULL;
}
static void make_descriptor(void) {
    if(descriptor)return;
    /* Native about/init both enter the guarded option reader 10002440. */
    thrash_load_configuration();
    descriptor=hle_va(hle_alloc(0xD0));modes=hle_va(hle_alloc(40*(MODE_COUNT+1)));
    lockdesc=hle_va(hle_alloc(20));
    surface_info=hle_va(hle_alloc(20));
    MEM32(lockdesc+4)=width*2;MEM32(lockdesc+8)=4;MEM32(lockdesc+12)=width;MEM32(lockdesc+16)=height;
    memcpy(hle_ptr(surface_info),hle_ptr(lockdesc),20);
    formats=hle_va(hle_alloc(16*4));
    MEM32(descriptor)=0x44334437;MEM32(descriptor+4)=0xD0;
    MEM32(descriptor+8)=107;
    MEM32(descriptor+12)=0x3F;
    MEM32(descriptor+16)=1;MEM32(descriptor+20)=4096;MEM32(descriptor+24)=1;
    MEM32(descriptor+28)=1;MEM32(descriptor+32)=4096;MEM32(descriptor+36)=1;
    MEM32(descriptor+44)=16;MEM32(descriptor+48)=formats;
    /* WebGPU textures are RGBA. Let the game convert indexed assets
     * through its existing fallback; palette-key/coverage semantics are not
     * fully represented by a plain CPU RGB palette expansion. */
    for(int i=3;i<=7;i++)MEM32(formats+i*4)=1;
    MEM32(descriptor+52)=4;MEM32(descriptor+56)=hle_va(hle_alloc(16));
    /* Thrash uses 1-based mode indices and +0x3C is the inclusive maximum,
     * not the allocation length (guest 00572A18..00572A6A). */
    MEM32(descriptor+60)=MODE_COUNT;MEM32(descriptor+64)=modes;MEM32(descriptor+68)=1;
    snprintf(hle_ptr(descriptor+0x4C),40,"WebGPU Thrash");
    MEM32(descriptor+0x78)=hle_guest_strdup("NFSPU preservation");
    MEM32(descriptor+0x7C)=7;
    /* The original graphics list subtracts triple-buffer bytes from +0x70
     * before admitting a mode (0044E83C..0044E864). Zero hid every mode.
     * This is a bounded guest budgeting allowance, not physical VRAM size. */
    MEM32(descriptor+0x70)=256u<<20;MEM32(descriptor+0x74)=3;
    for(unsigned depth=0;depth<2;depth++)for(unsigned i=0;i<MODE_RESOLUTIONS;i++) {
        uint32_t m=modes+(1+depth*MODE_RESOLUTIONS+i)*40;
        MEM32(m)=mode_sizes[i][0];MEM32(m+4)=mode_sizes[i][1];MEM32(m+8)=depth?32:16;
        /* +0x0C is the surface pixel-format enum, not flags. */
        MEM32(m+12)=depth?6:4;MEM32(m+16)=1;MEM32(m+20)=2;MEM32(m+24)=2;
    }
    /* Append a 32-bit browser-viewport mode without shifting saved mode indices.
     * The original chooser omits the two 320x240 modes, so this is property 26. */
    /* The frontend iterates [0, maximum), unlike the driver's [1, maximum].
     * Keep an unused final sentinel so both loops include the viewport mode. */
    uint32_t m=modes+VIEWPORT_MODE*40;
    MEM32(m)=win_viewport_width<640?640:win_viewport_width;
    MEM32(m+4)=win_viewport_height<480?480:win_viewport_height;
    MEM32(m+8)=32;MEM32(m+12)=6;MEM32(m+16)=1;MEM32(m+20)=2;MEM32(m+24)=2;
}
static void r_about(void){make_descriptor();RET(descriptor,0);}
static void r_init(void){make_descriptor();RET(1,0);}
static void r_is(void){RET(1,0);}
/* Native 10008732 maps 0/1 to front, 2 to back, 3 to auxiliary. With no
 * auxiliary buffers, window 3 still draws to back but omits color clears. */
static void r_window(void){
    uint32_t id=A32(0);state_values[0][59]=id;if(id>3)RET(0,1);
    window_color_clear=id!=3;nfspu_thrash_pump();RET(1,1);
}
static void r_selectdisplay(void){RET(A32(0)==0 ? 1:0,1);}
static void r_mode(void) {
    make_descriptor();uint32_t i=A32(0);
    if(!i||i>MODE_COUNT||!MEM32(modes+i*40+16))RET(0,3);
    width=MEM32(modes+i*40);height=MEM32(modes+i*40+4);
    uint32_t bits=A32(2);color_bits=bits==2||bits==32?32:16;
    if(color_bits>MEM32(modes+i*40+8))color_bits=16;
    if(opened){if(!gpu->resize(width,height))RET(0,3);}else if(!open_gpu())RET(0,3);
    hle_set_screen_size(width,height);
    web_projection_update(width,height);
    web_ui_update(width,height);
    MEM32(lockdesc+4)=width*color_bits/8;MEM32(lockdesc+8)=color_bits==16?4:6;
    MEM32(lockdesc+12)=width;MEM32(lockdesc+16)=height;
    memcpy(hle_ptr(surface_info),hle_ptr(lockdesc),20);MEM32(surface_info)=0;RET(1,3);
}
static void r_restore(void){nfspu_thrash_shutdown();RET(1,0);}
static void r_idle(void){nfspu_thrash_pump();RET(1,0);}
static int clip_is_partial(void){
    return render_state.scissor_enable && (render_state.scissor_x!=0||render_state.scissor_y!=0||
        render_state.scissor_w!=width||render_state.scissor_h!=height);
}
static void r_clear(void){
    if(open_gpu()){
        /* Native 10008650 selects enabled aspects; glClear also respects the
         * depth-write mask and scissor. Stencil's native clear value is zero. */
        uint32_t mask=(window_color_clear?1:0)|
            (render_state.depth_test&&render_state.depth_write?2:0)|(render_state.stencil_enable?4:0);
        if(clip_is_partial()){
            partial_clears++;
            gpu->clear(clear_color,clear_depth,mask,0,render_state.scissor_x,render_state.scissor_y,render_state.scissor_w,render_state.scissor_h);
        }else gpu->clear(clear_color,clear_depth,mask,0,0,0,width,height);
    }
    RET(1,0);
}
static void r_flush(void){RET(gpu_flush(),0);}


static void r_flip(void){int ok=open_gpu()&&gpu->present();frames++;RET(ok,0);}
/* The supplied OpenGL driver's sync entry is `mov eax,1; ret 4`. */
static void r_sync(void){nfspu_thrash_pump();RET(1,1);}
static void r_clip(void){
    uint32_t x=A32(0),y=A32(1),right=A32(2),bottom=A32(3);
    if(ui_draw_depth){
        x=(uint32_t)round((double)x*ui_scale[0]);right=(uint32_t)round((double)right*ui_scale[0]);
        y=(uint32_t)round((double)y*ui_scale[1]);bottom=(uint32_t)round((double)bottom*ui_scale[1]);
    }
    render_state.scissor_enable=1;render_state.scissor_x=x;render_state.scissor_y=y;
    render_state.scissor_w=right>x?right-x:0;render_state.scissor_h=bottom>y?bottom-y:0;
    RET(1,4);
}

static void submit(const nfspu_gpu_vertex *v,uint32_t n,const uint32_t *idx,uint32_t ni,uint32_t primitive) {
    if(!n || !open_gpu())return;
    nfspu_gpu_vertex *adjusted=NULL;
    int expanded=(ui_draw_depth||ui_stroke_depth)&&primitive&&(ui_scale[0]!=1||ui_scale[1]!=1);
    if(expanded){
        uint32_t count=idx?ni:n,step=primitive==1?2:1;
        if(count>2000000)hle_fatal("Thrash invalid UI primitive count %u",count);
        if(count<step)return;
        adjusted=malloc((size_t)(count/step)*6*sizeof *adjusted);
        if(!adjusted)hle_fatal("Thrash UI primitives allocation");
        n=web_ui_expand(primitive,v,n,idx,ni,adjusted,render_state.shade_mode==0,!ui_draw_depth);
        if(!n){free(adjusted);return;}
        v=adjusted;idx=NULL;ni=0;primitive=0;
    }
    if(ui_draw_depth||vertex_depth_bias!=0){
        if(!adjusted){
            adjusted=malloc((size_t)n*sizeof *adjusted);if(!adjusted)hle_fatal("Thrash adjusted vertices allocation");
            memcpy(adjusted,v,(size_t)n*sizeof *adjusted);
        }
        for(uint32_t i=0;i<n;i++){
            if(ui_draw_depth&&!expanded){adjusted[i].x*=ui_scale[0];adjusted[i].y*=ui_scale[1];}
            adjusted[i].z+=vertex_depth_bias;
        }v=adjusted;
    }
    nfspu_gpu_state s=render_state;s.primitive=primitive;
    /* Native 10008ADA: OGL_TEXFILTER 1 forces bilinear/trilinear, 2 forces
     * nearest spatial/mip sampling. Zero keeps the raw states 7 and 11. */
    if(s.texture&&thrash_texture_filter){
        s.filter_linear=thrash_texture_filter==1;
        if(s.mip_filter)s.mip_filter=thrash_texture_filter==1?2:1;
    }
    if(expanded)s.cull=1; /* Native line/point rasterization has no face culling. */
    if(!gpu->draw(v,n,idx,ni,&s))hle_fatal("WebGPU draw: %s",gpu_error);
    free(adjusted);
    draws++;
}
/* FVF state42 adds a second UV pair to indexed vertices. The native backend
 * currently consumes the first pair, but must still step over the full guest
 * record: casting a 40-byte array to 32-byte vertices corrupts the geometry. */
static void submit_guest(uint32_t va,uint32_t n,const uint32_t *idx,uint32_t ni,uint32_t primitive,uint32_t stride) {
    if(stride==sizeof(nfspu_gpu_vertex)){submit(hle_ptr(va),n,idx,ni,primitive);return;}
    if(stride<sizeof(nfspu_gpu_vertex)||stride>128||n>1000000)hle_fatal("invalid Thrash vertex layout %u/%u",stride,n);
    nfspu_gpu_vertex *packed=malloc((size_t)n*sizeof *packed);
    if(!packed)hle_fatal("Thrash vertex allocation");
    for(uint32_t i=0;i<n;i++)memcpy(packed+i,hle_ptr(va+i*stride),sizeof *packed);
    submit(packed,n,idx,ni,primitive);free(packed);
}
static void pointers(uint32_t count) {
    nfspu_gpu_vertex v[4];for(uint32_t i=0;i<count;i++)memcpy(v+i,APTR(i),32);
    if(count==4){const uint32_t idx[]={0,1,2,2,3,0};submit(v,4,idx,6,0);}else submit(v,count,NULL,0,count==2?1:count==1?2:0);
}
static void r_tri(void){pointers(3);RET(1,3);}
static void r_quad(void){pointers(4);RET(1,4);}
static void r_line(void){pointers(2);RET(1,2);}
static void r_point(void){pointers(1);RET(1,1);}
/* Indexed mesh entry points take (primitive count, vertices, uint32 indices). */
static void mesh(uint32_t vertices_per_primitive,uint32_t primitive,uint32_t stride) {
    uint32_t count=A32(0),p=A32(2);if(!count||count>1000000||!p)return;
    uint32_t ni=count*vertices_per_primitive,max=0;
    const uint32_t *idx=APTR(2);for(uint32_t i=0;i<ni;i++)if(idx[i]>max)max=idx[i];
    if(max>1000000)hle_fatal("Thrash invalid mesh index %u",max);
    if(vertices_per_primitive==4) {
        uint32_t *tri=malloc(count*6*sizeof *tri);if(!tri)hle_fatal("Thrash indices allocation");
        for(uint32_t i=0;i<count;i++){uint32_t a=idx[i*4],b=idx[i*4+1],c=idx[i*4+2],d=idx[i*4+3];uint32_t t[]={a,b,c,c,d,a};memcpy(tri+i*6,t,sizeof t);}
        submit_guest(A32(1),max+1,tri,count*6,0,stride);free(tri);
    } else submit_guest(A32(1),max+1,idx,ni,primitive,stride);
}
static void r_trimesh(void){mesh(3,0,vertex_stride);RET(1,3);}
static void r_quadmesh(void){mesh(4,0,vertex_stride);RET(1,3);}
static void r_linemesh(void){mesh(2,1,vertex_stride);RET(1,3);}
static void r_pointmesh(void){mesh(1,2,32);RET(1,3);}
static void strip(uint32_t v,uint32_t p,uint32_t count,int fan,int line,uint32_t stride) {
    if(count<2||count>1000000)return;
    uint32_t triangles=line?count-1:count-2, step=line?2:3;
    uint32_t *idx=malloc(triangles*step*4);if(!idx)hle_fatal("Thrash strip allocation");
    uint32_t max=0;for(uint32_t i=0;i<triangles;i++)for(uint32_t k=0;k<step;k++) {
        uint32_t j=line?i+k:fan?(k?i+k:0):i+((i&1)&&k<2?1-k:k);
        uint32_t x=p?MEM32(p+j*4):j;idx[i*step+k]=x;if(x>max)max=x;
    }
    submit_guest(v,max+1,idx,triangles*step,line?1:0,stride);free(idx);
}
static void r_tristrip3(void){strip(A32(1),A32(2),A32(0)+2,0,0,vertex_stride);RET(1,3);}
static void r_trifan3(void){strip(A32(1),A32(2),A32(0)+2,1,0,vertex_stride);RET(1,3);}
static void r_linestrip3(void){strip(A32(1),A32(2),A32(0)+1,0,1,32);RET(1,3);}
static void r_tristrip2(void){strip(A32(1),0,A32(0)+2,0,0,32);RET(1,2);}
static void r_trifan2(void){strip(A32(1),0,A32(0)+2,1,0,32);RET(1,2);}
static void r_linestrip2(void){strip(A32(1),0,A32(0)+1,0,1,32);RET(1,2);}
static void r_pointstrip(void){submit(APTR(1),A32(0),NULL,0,2);RET(1,2);}
static void sprite(const nfspu_gpu_vertex *a,const nfspu_gpu_vertex *b) {
    nfspu_gpu_vertex v[4]={*a,*a,*b,*b};v[1].x=b->x;v[1].u=b->u;v[3].x=a->x;v[3].u=a->u;
    const uint32_t idx[]={0,1,2,0,2,3};submit(v,4,idx,6,0);
}
static void r_sprite(void){sprite(APTR(0),APTR(1));RET(1,2);}
static void r_spritemesh(void){uint32_t n=A32(0),v=A32(1),idx=A32(2);for(uint32_t i=0;i<n;i++)sprite(hle_ptr(v+MEM32(idx+i*8)*sprite_stride),hle_ptr(v+MEM32(idx+i*8+4)*sprite_stride));RET(1,3);}

static void r_talloc(void) {
    uint32_t w=A32(0),h=A32(1),f=A32(2);if(!w||!h||w>16384||h>16384)RET(0,5);
    /* Native +0x10 is the additional mip count, from argument 5's low word.
     * _THRASH_tupdate uploads the supplied levels consecutively, largest first. */
    uint32_t levels=(A32(4)&0xFFFF)+1,max_levels=1;
    for(uint32_t extent=w>h?w:h;extent>1;extent>>=1)max_levels++;
    if(levels>max_levels)RET(0,5);
    for(int i=0;i<MAX_TEXTURES;i++)if(!textures[i].va) {
        uint32_t va=hle_va(hle_alloc(128));textures[i]=(texture_slot){va,0,w,h,f,levels};
        MEM32(va)=w;MEM32(va+4)=h;MEM32(va+8)=f;MEM32(va+12)=A32(3);MEM32(va+16)=A32(4);RET(va,5);
    } RET(0,5);
}
static void release_texture(texture_slot *t){if(t->gpu_id&&opened)gpu->texture_destroy(t->gpu_id);if(state_values[0][1]==t->va){state_values[0][1]=0;render_state.texture=0;}free(t->pixels);free(t->palette);hle_free(hle_ptr(t->va));memset(t,0,sizeof *t);}
static void r_tfree(void){texture_slot *t=find_texture(A32(0));if(t)release_texture(t);RET(1,1);}
static void r_treset(void){for(int i=0;i<MAX_TEXTURES;i++)if(textures[i].va)release_texture(&textures[i]);render_state.texture=0;RET(1,0);}
static void r_tupdate(void) {
    texture_slot *t=find_texture(A32(0));if(!t||!open_gpu())RET(0,3);
    size_t n=gpu_texture_pixels(t->width,t->height,t->mip_levels),bytes=0;
    if(t->format==1)bytes=(n+1)/2;else if(t->format==2)bytes=n;
    else if(t->format==3||t->format==4||t->format==7)bytes=n*2;
    else if(t->format==5)bytes=n*3;else if(t->format==6)bytes=n*4;else RET(0,3);
    if(A32(1)){if(!t->pixels)t->pixels=malloc(bytes);if(!t->pixels)RET(0,3);memcpy(t->pixels,APTR(1),bytes);}
    if(A32(2)&&(t->format==1||t->format==2)){
        if(!t->palette)t->palette=calloc(256,sizeof *t->palette);if(!t->palette)RET(0,3);
        memcpy(t->palette,APTR(2),(t->format==1?16:256)*sizeof *t->palette);
    }
    if(!t->pixels)RET(t->va,3);
    uint8_t *rgba=malloc(n*4);if(!rgba)RET(0,3);
    const uint8_t *px=t->pixels;const uint32_t *pal=t->palette;
    for(size_t i=0;i<n;i++) {
        uint32_t r=0,g=0,b=0,a=255,v;
        switch(t->format) {
        case 1:case 2:{uint32_t index=t->format==1?((px[i/2]>>((i&1)*4))&15):px[i];v=pal?pal[index]:0;r=(v>>16)&255;g=(v>>8)&255;b=v&255;break;}
        case 3:v=((const uint16_t*)px)[i];r=((v>>10)&31)*255/31;g=((v>>5)&31)*255/31;b=(v&31)*255/31;a=(v&0x8000)?255:0;break;
        case 4:v=((const uint16_t*)px)[i];r=((v>>11)&31)*255/31;g=((v>>5)&63)*255/63;b=(v&31)*255/31;break;
        case 5:b=px[i*3];g=px[i*3+1];r=px[i*3+2];break;
        case 6:v=((const uint32_t*)px)[i];r=(v>>16)&255;g=(v>>8)&255;b=v&255;a=v>>24;break;
        case 7:v=((const uint16_t*)px)[i];r=((v>>8)&15)*17;g=((v>>4)&15)*17;b=(v&15)*17;a=((v>>12)&15)*17;break;
        default:free(rgba);RET(0,3);
        }
        rgba[i*4]=r;rgba[i*4+1]=g;rgba[i*4+2]=b;rgba[i*4+3]=a;
    }
    int ok=1;if(t->gpu_id)ok=gpu->texture_update(t->gpu_id,rgba);else t->gpu_id=gpu->texture_create(t->width,t->height,rgba,t->mip_levels);
    
    
    if(state_values[0][1]==t->va)render_state.texture=t->gpu_id;
    free(rgba);uploads++;RET(ok&&t->gpu_id?t->va:0,3);
}
static void r_texture(void){state_values[0][1]=A32(0);texture_slot *t=find_texture(A32(0));render_state.texture=t?t->gpu_id:0;RET(1,1);}
static int known_state(uint32_t s){return s<=70||(s>=100&&s<=110)||(s>=200&&s<=215)||(s>=300&&s<=315)||(s>=400&&s<=415)||(s>=700&&s<=715);}
static void r_getstate(void){uint32_t s=A32(0)&0xFFFF,stage=(A32(0)>>16)&7;if(s==29){make_descriptor();RET(surface_info,1);}RET(known_state(s)?state_values[stage][s]:0xFFFFFFFFu,1);}
static void r_state(void) {
    uint32_t raw=A32(0),s=raw&0xFFFF,v=A32(1);
    uint32_t stage=(raw>>16)&7;
    /* Original 0044EB82 probes this extension with zero before enabling the
     * detailed frontend path (6197AA). Verok's OpenGL3 driver accepts it
     * without storing state. Our Gouraud/alpha draws support that path too. */
    if(raw==451&&v==0)RET(1,2);
    /* State 37 is an optional timer hook. Advertising it installs a callback
     * that must be implemented, not an innocuous successful no-op. */
    if(!known_state(s)||!s||s==12||s==16||s==17||s==29||s==34||s==37||s==38||
       (s>=43&&s<=45)||(s>=68&&s<=100)||(s>=107&&s!=404&&s!=405))RET(0,2);
    if(s==10&&v>(thrash_version>=107?3u:2u))RET(0,2);
    if((s==404||s==405)&&v>9)RET(0,2);
    if((s==56||s==104)&&v>3)RET(0,2);
    if(s==2&&v>2)RET(0,2);
    if(s==4&&v>1)RET(0,2);
    if(s==6&&v>2)RET(0,2);
    if((s==48||(s>=52&&s<=54))&&v>7)RET(0,2);
    if((s==13||s==65||s==66)&&v>2)RET(0,2);
    if(s==30&&(v<32||v>128))RET(0,2);
    uint32_t previous=state_values[stage][s];
    if(s<1024&&known_state(s))state_values[stage][s]=v;
    if(trace)fprintf(stderr,"[thrash] setstate(%u,0x%08X)\n",raw,v);
    /* State numbers are the Thrash ABI, not D3DRENDERSTATETYPE. */
    switch(s) {
    case 1:{if(stage)break;texture_slot *t=find_texture(v);render_state.texture=t?t->gpu_id:0;break;}
    case 2:render_state.cull=v==0?1:v==2?2:3;break;
    case 4:render_state.depth_test=v!=0;break;
    /* Native 10006716: flat, Gouraud, Gouraud with specular addition. */
    case 6:render_state.shade_mode=v;break;
    /* Native 10008AF1 uses state 7 for spatial filtering and 11 for mips.
     * States 13/65/66 select clamp, repeat or mirrored repeat on both/U/V. */
    case 7:render_state.filter_linear=v!=0;break;
    case 8:render_state.mip_lod_bias=as_float(v);break;
    case 11:render_state.mip_filter=v==0?0:v==1?1:2;break;
    case 13:if(previous!=v){render_state.address_u=render_state.address_v=v;render_state.address_wrap=v==1;}break;
    case 65:if(previous!=v)render_state.address_u=v;break;
    case 66:if(previous!=v)render_state.address_v=v;break;
    /* Native 10005FB7: v0/v1 disable blending for ABI >=107; v2/v3
     * enable blending and alpha > reference. Older ABIs enable v1 too.
     * State 36 changes only the reference, including the valid value zero. */
    case 10:
        render_state.blend_enable=thrash_version>=107?v>=2:v!=0;
        render_state.alpha_test=render_state.blend_enable;
        render_state.alpha_func=render_state.alpha_test?4:7;break;
    /* Native 10006246/100062EF/1000631E/1000634D: ARGB fog strength,
     * unsigned integer range endpoints, and reciprocal-or-float density. */
    case 14:if(previous!=v)render_state.fog_density=v>0&&v<4096?1.0f/v:as_float(v);break;
    case 15:if(previous!=v)render_state.fog_color=v;break;
    case 22:if(previous!=v)render_state.fog_near=(float)v;break;
    case 23:if(previous!=v)render_state.fog_far=(float)v;break;
    case 19:callbacks=v;break;
    /* The supplied driver's 20/21/105 aliases all reach 1000620C.
     * Zero disables, one restores the last selected mode, and other values
     * select the shader mode. Only native modes 2/4/8 draw fog; a pointer or
     * mode 16 is not a fog-table upload in this OpenGL renderer. */
    case 20:case 21:case 105:
        if(previous!=v){
            if(v>1)selected_fog_mode=v;
            uint32_t mode=v==1?selected_fog_mode:v;
            render_state.fog_mode=mode==2?1:mode==4?2:mode==8?3:0;
            render_state.fog_enable=render_state.fog_mode!=0;
        }
        break;
    case 24:case 102:vertex_depth_bias=(float)(int32_t)v/32768.0f;break;
    case 30:sprite_stride=v;break;
    case 31:thrash_version=v;break;
    case 36:render_state.alpha_ref=v;break;
    case 40:render_state.depth_func=v+1;break;
    /* Verok retains state 41 but its shader always multiplies texture RGBA
     * by diffuse RGBA; it does not select alpha or disable the texture here. */
    case 41:break;
    case 42:if(v<=1)vertex_stride=v?40:32;break;
    /* Native 10006428..100065FD: stencil compare/reference mask and ops. */
    case 47:render_state.stencil_enable=v!=0;break;
    case 48:render_state.stencil_func=v;break;
    case 52:render_state.stencil_fail=v;break;
    case 53:render_state.stencil_depth_fail=v;break;
    case 54:render_state.stencil_pass=v;break;
    case 56:case 104:
        {const uint32_t src[]={2,2,1,7},dst[]={3,0,3,1};
        state_values[stage][404]=src[v];state_values[stage][405]=dst[v];
        render_state.src_blend=native_blend_factors[src[v]];render_state.dst_blend=native_blend_factors[dst[v]];}
        break;
    case 404:case 405:
        if(s==404)render_state.src_blend=native_blend_factors[v];else render_state.dst_blend=native_blend_factors[v];
        state_values[stage][56]=state_values[stage][104]=4;
        break;
    case 57:case 106:render_state.depth_write=v!=0;break;
    case 3:clear_color=v;break;
    case 67:clear_depth=as_float(v);break;
    default:break;
    }
    uint32_t callback=state_values[0][39];
    if(callback&&previous!=v) {uint32_t args[]={s,v};hle_call_guest(callback,2,args);}
    RET(1,2);
}
static void r_lock(void) {
    if(!open_gpu())RET(0,0);
    if(!lockdesc)lockdesc=hle_va(hle_alloc(32));
    uint32_t required=width*height*color_bits/8;
    if(required>framebuffer_capacity){if(framebuffer)hle_free(hle_ptr(framebuffer));framebuffer=hle_va(hle_alloc(required));framebuffer_capacity=required;}
    uint8_t *rgba=malloc((size_t)width*height*4);if(!rgba)RET(0,0);
    int ok=gpu->read_pixels(rgba,width,height);
    if(ok)for(uint32_t i=0;i<width*height;i++) {
        if(color_bits==16)MEM16(framebuffer+i*2)=((rgba[i*4]>>3)<<11)|((rgba[i*4+1]>>2)<<5)|(rgba[i*4+2]>>3);
        else MEM32(framebuffer+i*4)=0xFF000000u|rgba[i*4]<<16|rgba[i*4+1]<<8|rgba[i*4+2];
    }
    free(rgba);MEM32(lockdesc)=framebuffer;MEM32(lockdesc+4)=width*color_bits/8;MEM32(lockdesc+8)=color_bits==16?4:6;MEM32(lockdesc+12)=width;MEM32(lockdesc+16)=height;
    RET(ok?lockdesc:0,0);
}
static uint8_t *decode_window_pixels(uint32_t p,uint32_t w,uint32_t h) {
    if(!p||!w||!h||w>16384||h>16384)return NULL;
    uint8_t *rgba=malloc((size_t)w*h*4);if(!rgba)return NULL;
    for(uint32_t i=0;i<w*h;i++) {
        uint32_t r,g,b;
        if(color_bits==16){uint32_t v=MEM16(p+i*2);r=((v>>11)&31)*255/31;g=((v>>5)&63)*255/63;b=(v&31)*255/31;}
        else{uint32_t v=MEM32(p+i*4);r=(v>>16)&255;g=(v>>8)&255;b=v&255;}
        rgba[i*4]=r;rgba[i*4+1]=g;rgba[i*4+2]=b;rgba[i*4+3]=255;
    }return rgba;
}
static int blit_pixels(uint32_t p,uint32_t x,uint32_t y,uint32_t w,uint32_t h) {
    if(!open_gpu())return 0;
    uint8_t *rgba=decode_window_pixels(p,w,h);if(!rgba)return 0;
    uint32_t tex=gpu->texture_create(w,h,rgba,1);free(rgba);if(!tex)return 0;
    nfspu_gpu_vertex v[4]={{x,y,0,1,0xFFFFFFFF,0,0,0},{x+w,y,0,1,0xFFFFFFFF,0,1,0},{x+w,y+h,0,1,0xFFFFFFFF,0,1,1},{x,y+h,0,1,0xFFFFFFFF,0,0,1}};
    if(ui_draw_depth)for(unsigned i=0;i<4;i++){v[i].x*=ui_scale[0];v[i].y*=ui_scale[1];}
    const uint32_t idx[]={0,1,2,0,2,3};nfspu_gpu_state s={.texture=tex,.src_blend=2,.dst_blend=1,.cull=1,.color_write=1};
    int ok=gpu->draw(v,4,idx,6,&s);gpu->texture_destroy(tex);return ok;
}
static void r_unlock(void){
    uint32_t p=A32(0)?MEM32(A32(0)):framebuffer;
    int ok=blit_pixels(p,0,0,width,height);
    /* Software movie playback writes the front buffer directly and never
     * calls pageflip. The original surface Unlock made those writes visible. */
    if(ok)ok=gpu->present();
    nfspu_thrash_pump();
    software_frames++;
    RET(ok,1);
}
static void r_readrect(void){
    uint32_t x=A32(0),y=A32(1),w=A32(2),h=A32(3),p=A32(4);
    if(!p||!w||!h||x>width||y>height||w>width-x||h>height-y||!open_gpu())RET(0,5);
    uint8_t *rgba=malloc((size_t)width*height*4);if(!rgba)RET(0,5);
    int ok=gpu->read_pixels(rgba,width,height);
    if(ok)for(uint32_t j=0;j<h;j++)for(uint32_t i=0;i<w;i++){
        uint8_t *s=rgba+((size_t)(j+y)*width+x+i)*4;uint32_t n=j*w+i;
        if(color_bits==16)MEM16(p+n*2)=((s[0]>>3)<<11)|((s[1]>>2)<<5)|(s[2]>>3);
        else MEM32(p+n*4)=0xFF000000u|s[0]<<16|s[1]<<8|s[2];
    }free(rgba);RET(ok,5);
}
static void r_writerect(void){RET(blit_pixels(A32(4),A32(0),A32(1),A32(2),A32(3)),5);}

/* nfs5.dll:10003320 guards four original readback call sites. Preserve the
 * native signed comparisons, wrapping arithmetic and one-pixel edge margin. */
static uint32_t verok_read_coordinate(uint32_t position,uint32_t size,uint32_t extent) {
    if((int32_t)position<0)position=0;
    if((int32_t)(position+size)>=(int32_t)extent)position=extent-size-1;
    return position;
}
static void verok_readrect(void) {
    uint32_t w=A32(2),h=A32(3),p=A32(4);
    g_edx=verok_read_coordinate(A32(0),w,width);
    g_ecx=verok_read_coordinate(A32(1),h,height);
    uint32_t args[]={g_edx,g_ecx,w,h,p};
    RET(hle_call_guest(MEM32(0x6BD96C),5,args),5);
}

typedef struct export_entry {const char *name;void(*fn)(void);} export_entry;
static const export_entry th_exports[]={
    {"_THRASH_about@0",r_about},{"_THRASH_clearwindow@0",r_clear},{"_THRASH_clip@16",r_clip},
    {"_THRASH_drawline@8",r_line},{"_THRASH_drawlinemesh@12",r_linemesh},{"_THRASH_drawlinestrip@12",r_linestrip3},{"_THRASH_drawlinestrip@8",r_linestrip2},
    {"_THRASH_drawpoint@4",r_point},{"_THRASH_drawpointmesh@12",r_pointmesh},{"_THRASH_drawpointstrip@8",r_pointstrip},
    {"_THRASH_drawquad@16",r_quad},{"_THRASH_drawquadmesh@12",r_quadmesh},{"_THRASH_drawsprite@8",r_sprite},{"_THRASH_drawspritemesh@12",r_spritemesh},
    {"_THRASH_drawtri@12",r_tri},{"_THRASH_drawtrifan@12",r_trifan3},{"_THRASH_drawtrifan@8",r_trifan2},{"_THRASH_drawtrimesh@12",r_trimesh},{"_THRASH_drawtristrip@12",r_tristrip3},{"_THRASH_drawtristrip@8",r_tristrip2},
    {"_THRASH_flushwindow@0",r_flush},{"_THRASH_getstate@4",r_getstate},{"_THRASH_idle@0",r_idle},{"_THRASH_init@0",r_init},{"_THRASH_is@0",r_is},{"_THRASH_lockwindow@0",r_lock},
    {"_THRASH_pageflip@0",r_flip},{"_THRASH_readrect@20",r_readrect},{"_THRASH_restore@0",r_restore},{"_THRASH_selectdisplay@4",r_selectdisplay},
    {"_THRASH_setstate@8",r_state},{"_THRASH_settexture@4",r_texture},{"_THRASH_setvideomode@12",r_mode},{"_THRASH_sync@4",r_sync},
    {"_THRASH_talloc@20",r_talloc},{"_THRASH_tfree@4",r_tfree},{"_THRASH_treset@0",r_treset},{"_THRASH_tupdate@12",r_tupdate},{"_THRASH_unlockwindow@4",r_unlock},{"_THRASH_window@4",r_window},{"_THRASH_writerect@20",r_writerect},{NULL,NULL}
};

#undef RET
#undef A32
#undef APTR
#undef hle_ptr
#undef hle_va
#undef hle_alloc
#undef hle_free
#undef hle_guest_strdup
#undef hle_call_guest
#undef hle_fatal
static uint32_t thrash_module(const char *name) {
    if(!name)return 0;
    const char *base=name;
    for(const char *p=name;*p;p++)if(*p=='/'||*p=='\\')base=p+1;
    size_t n=strlen(base);if(n>4&&!strcasecmp(base+n-4,".dll"))n-=4;
    return (n==8&&!strncasecmp(base,"opengl3z",8))||(n==4&&!strncasecmp(base,"dx7z",4))?THRASH_MODULE:0;
}
static uint32_t thrash_proc(uint32_t symbol) {
    if(symbol<0x10000)return symbol>=1&&symbol<=41?0xF5000000+(symbol-1)*16:0;
    for(unsigned i=0;th_exports[i].name;i++)if(!strcmp(th_exports[i].name,(const char*)ADDR(symbol)))return 0xF5000000+i*16;
    return 0;
}
static recomp_func_t thrash_lookup(uint32_t address) {
    if(address==0x10003320u)return verok_readrect;
    if(address<0xF5000000||address>=0xF5000290||(address&15))return NULL;
    thrash_calls++;return th_exports[(address-0xF5000000)/16].fn;
}
static void thrash_reset(void) {
    for(unsigned i=0;i<MAX_TEXTURES;i++){free(textures[i].pixels);free(textures[i].palette);}
    memset(textures,0,sizeof textures);memset(state_values,0,sizeof state_values);
    descriptor=modes=formats=framebuffer=framebuffer_capacity=lockdesc=surface_info=callbacks=0;
    width=640;height=480;color_bits=16;window_color_clear=1;opened=trace=0;thrash_version=107;
    clear_color=0xFF000000;clear_depth=1;vertex_depth_bias=0;selected_fog_mode=0;
    thrash_configuration_loaded=thrash_environment_loaded=0;thrash_texture_filter=0;
    frames=draws=uploads=software_frames=partial_clears=thrash_calls=0;vertex_stride=sprite_stride=32;
    render_state=(nfspu_gpu_state){.src_blend=5,.dst_blend=6,.filter_linear=1,.cull=1,.depth_write=1,.depth_func=4,.shade_mode=1,.alpha_modulate=1,.mip_filter=1,.alpha_func=4,
        .stencil_func=7,.stencil_ref=2,.stencil_read_mask=255,.stencil_write_mask=255,.color_write=1};
    state_values[0][48]=7;
    state_values[0][6]=state_values[0][7]=state_values[0][11]=1;
    state_values[0][404]=2;state_values[0][405]=3;
}
#endif
