/* Verok nfs5.dll:10003840 projection math. Window placement remains browser-owned. */
#ifndef NFS5_WEB_PROJECTION_H
#define NFS5_WEB_PROJECTION_H
#include <math.h>

float web_projection[3]={640,480,37.5f}; /* virtual width, virtual height, half-FOV */
static uint32_t projection_width=640,projection_height=480;

void web_projection_update(uint32_t width,uint32_t height) {
    if(!width||!height||width>16384||height>16384)return;
    projection_width=width;projection_height=height;
    /* Mirror the native float input/output stores and constants. Differential
     * checks compare the stored floats against its x87 calculation. */
    double ratio=(double)(float)width/(double)(float)height;
    if(ratio<=1.3333333730697632) {
        web_projection[0]=640;
        web_projection[1]=(float)(640.0/ratio);
        web_projection[2]=37.5f;
    } else {
        web_projection[0]=(float)(480.0*ratio);
        web_projection[1]=480;
        web_projection[2]=(float)(atan2(3.0*ratio,4.0/tan(37.5*0.017453292))/0.017453292);
    }
}

uint32_t web_projection_bits(unsigned field) {
    uint32_t bits;memcpy(&bits,web_projection+field,4);return bits;
}

float *web_projection_state(void){return web_projection;}

double web_flare_angle(double position_sum) {
    // Original 00451762 rotates sprites by (screen.x + screen.y) / 1440 turns.
    // Keep the 640×480 centre/orientation and angular scale when pixel density
    // or aspect changes. Projection scale also handles portrait viewports.
    double logical=560.0+(position_sum-.5*(projection_width+projection_height))*web_projection[0]/projection_width;
    return logical*0.0006944444444444445;
}
#endif
