/* Keep the original pixel-based interface readable independently of race pixels. */
#ifndef NFS5_WEB_UI_H
#define NFS5_WEB_UI_H
static uint32_t ui_size[2]={640,480};
static uint32_t ui_pixels[2]={640,480};
static uint32_t ui_mouse_buffer;
static float ui_scale[2]={1,1};
static __thread uint32_t ui_draw_depth;

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
static void web_ui_update(uint32_t w,uint32_t h) {
    for(unsigned axis=0;axis<2;axis++){
        ui_size[axis]=web_ui_layout(w,h,axis);
        ui_pixels[axis]=axis?h:w;
        ui_scale[axis]=(float)ui_pixels[axis]/ui_size[axis];
    }
}
#endif
