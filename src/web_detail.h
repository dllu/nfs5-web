#ifndef NFS5_WEB_DETAIL_H
#define NFS5_WEB_DETAIL_H
static uint32_t detail_mode,detail_views,detail_cars,detail_models;
static double detail_scale=1,detail_native_range,detail_range;
static void detail_reset(void){detail_mode=detail_views=detail_cars=detail_models=0;detail_scale=1;detail_native_range=detail_range=0;}
void web_detail_view(void){
    detail_native_range=*(float*)ADDR(0x6197CC);detail_range=detail_native_range*detail_scale;detail_views++;
    if(detail_mode)*(float*)ADDR(0x6197CC)=(float)detail_range;
}
double web_detail_car(double extent){detail_cars++;return detail_mode?extent*detail_scale:extent;}
double web_detail_limit(double squared){return detail_mode?squared*detail_scale*detail_scale:squared;}
double web_detail_model(double squared){detail_models++;return detail_mode?squared/(detail_scale*detail_scale):squared;}
void web_detail_mode(uint32_t mode){machine_acquire();detail_mode=mode<=2?mode:0;detail_scale=detail_mode==2?4:detail_mode==1?2:1;machine_release();}
double *web_detail_stats(void){
    static double stats[8];machine_acquire();
    stats[0]=detail_mode;stats[1]=detail_scale;stats[2]=detail_native_range;stats[3]=detail_range;
    stats[4]=detail_views;stats[5]=detail_cars;stats[6]=detail_models;stats[7]=detail_scale*detail_scale;
    machine_release();return stats;
}
#endif
