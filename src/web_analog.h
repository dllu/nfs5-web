#ifndef NFS5_WEB_ANALOG_H
#define NFS5_WEB_ANALOG_H
static uint32_t analog_active,analog_target,analog_reads,analog_values[4];
static float analog_steer,analog_pedal;
static int analog_channel(void) {
    // Original INPUT_poll's first player's left/right/gas/brake bindings.
    // Their device callbacks return 0..255. The original poller converts these
    // to the signed steering byte / pedal channels used by analog devices.
    // Other key reads, including menu navigation, remain ordinary key input.
    if(g_cur_func<0x00412E70||g_cur_func>0x004137F0)return -1;
    if(g_esi<0x005E9670||g_esi>0x005E967C||(g_esi&3))return -1;
    return (g_esi-0x005E9670)/4;
}
static void analog_read(void) {
    int channel=analog_channel();uint32_t target=analog_target;
    recomp_lookup(target)();
    if(channel<0)return;
    double value=channel==0?-analog_steer:channel==1?analog_steer:channel==2?analog_pedal:-analog_pedal;
    uint32_t axis=(uint32_t)lround(fmax(0,value)*255.0);
    if(g_eax<axis)g_eax=axis;
    analog_values[channel]=g_eax;analog_reads++;
}
static recomp_func_t analog_lookup(uint32_t target) {
    if(!analog_active||analog_channel()<0)return NULL;
    switch(target){
    case 0x00508E70:case 0x00411B80:case 0x00411A50:
    case 0x00411C20:case 0x00411C80:case 0x00411AC0:
        analog_target=target;return analog_read;
    default:return NULL;
    }
}
static void analog_reset(void){analog_active=analog_reads=0;analog_steer=analog_pedal=0;memset(analog_values,0,sizeof analog_values);}
void web_input_analog(double steer,double pedal,uint32_t active) {
    machine_acquire();analog_steer=active?fmax(-1,fmin(1,steer)):0;analog_pedal=active?fmax(-1,fmin(1,pedal)):0;analog_active=active;
    if(!active)memset(analog_values,0,sizeof analog_values);machine_release();
}
uint32_t *web_analog_state(void){
    static uint32_t state[8];machine_acquire();state[0]=analog_active;state[1]=analog_reads;memcpy(state+2,analog_values,sizeof analog_values);memcpy(state+6,&analog_steer,4);memcpy(state+7,&analog_pedal,4);machine_release();return state;
}
#endif
