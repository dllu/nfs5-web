/* Keep the original pixel-based interface readable independently of race pixels. */
#ifndef NFS5_WEB_UI_H
#define NFS5_WEB_UI_H
static uint32_t ui_size[2]={640,480};
static uint32_t ui_pixels[2]={640,480};
static uint32_t ui_mouse_buffer;
static float ui_scale[2]={1,1};
static __thread uint32_t ui_draw_depth;
static __thread uint32_t ui_stroke_depth;

uint32_t web_ui_layout(uint32_t w,uint32_t h,unsigned axis) {
    if(w<640||h<480||w>16384||h>16384)return axis?h:w;
    if((uint64_t)w*480>=(uint64_t)h*640)
        return axis?480:(uint32_t)(((uint64_t)w*480+h/2)/h);
    return axis?(uint32_t)(((uint64_t)h*640+w/2)/w):640;
}
uint32_t web_ui_extent(unsigned axis){return ui_size[axis];}
int32_t web_ui_coordinate(int32_t value,unsigned axis){return (int32_t)floor((double)value*ui_size[axis]/ui_pixels[axis]+0.5);}
void web_ui_begin(void){ui_draw_depth++;}
void web_ui_end(void){if(ui_draw_depth)ui_draw_depth--;}
void web_ui_strokes(uint32_t active){if(active)ui_stroke_depth++;else if(ui_stroke_depth)ui_stroke_depth--;}
static void web_ui_update(uint32_t w,uint32_t h) {
    for(unsigned axis=0;axis<2;axis++){
        ui_size[axis]=web_ui_layout(w,h,axis);
        ui_pixels[axis]=axis?h:w;
        ui_scale[axis]=(float)ui_pixels[axis]/ui_size[axis];
    }
}

/* H321Go caches its center and the two ends of its animated motion. Move
 * both ends by the same offset so resizing preserves animation progress. */
static void web_ui_countdown(uint32_t hud) {
    if(!hud||(MEM32(hud+0x4C)==ui_size[0]&&MEM32(hud+0x50)==ui_size[1]))return;
    uint32_t dx=ui_size[0]/2-MEM32(hud+0x54),dy=ui_size[1]/2-MEM32(hud+0x58);
    MEM32(hud+0x4C)=ui_size[0];MEM32(hud+0x50)=ui_size[1];
    MEM32(hud+0x54)=ui_size[0]/2;MEM32(hud+0x58)=ui_size[1]/2;
    MEM32(hud+0x5C)+=dx;MEM32(hud+0x60)+=dy;
    MEM32(hud+0x64)+=dx;MEM32(hud+0x68)+=dy;
    MEM32(hud+0xB4)+=dx;MEM32(hud+0xB8)+=dy;
}

/* The singleplayer start overlay also caches the countdown sprites and
 * keyframe positions for the four quadrants of the screen. */
static void web_ui_countdown_overlay(uint32_t hud) {
    if(!hud)return;
    uint32_t old_w=MEM32(hud+0x4A4),old_h=MEM32(hud+0x4A8);
    if(!old_w||!old_h||(old_w==ui_size[0]&&old_h==ui_size[1]))return;
    int32_t dx=(int32_t)(ui_size[0]/2)-(int32_t)(old_w/2);
    int32_t dy=(int32_t)(ui_size[1]/2)-(int32_t)(old_h/2);
    MEM32(hud+0x4A4)=ui_size[0];MEM32(hud+0x4A8)=ui_size[1];
    MEM32(hud+0x4AC)=ui_size[0]/2;MEM32(hud+0x4B0)=ui_size[1]/2;
    MEM32(hud+0x4B4)+=dx;MEM32(hud+0x4B8)+=dy;
    for(unsigned key=0xC8;key<=0x334;key+=20) {
        MEM32(hud+key)=(MEM32(hud+key)*ui_size[0]+old_w/2)/old_w;
        MEM32(hud+key+4)=(MEM32(hud+key+4)*ui_size[1]+old_h/2)/old_h;
    }
    for(unsigned offset=0x484;offset<=0x4A0;offset+=4) {
        uint32_t sprite=MEM32(hud+offset);
        if(!sprite)continue;
        MEM32(sprite+4)+=dx;MEM32(sprite+8)+=dy;
        for(unsigned vertex=0x1C;vertex<=0x4C;vertex+=16) {
            float *xy=(float*)ADDR(sprite+vertex);
            xy[0]+=dx;xy[1]+=dy;
        }
    }
}
#endif
