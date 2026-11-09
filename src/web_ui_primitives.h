/* WebGPU lines/points stay one physical pixel wide. Expand enlarged interface
 * primitives into triangles so their thickness follows the logical UI canvas.
 * Camera passes set physical to retain their already-projected positions. */
#ifndef NFS5_WEB_UI_PRIMITIVES_H
#define NFS5_WEB_UI_PRIMITIVES_H
uint32_t web_ui_expand(uint32_t primitive,const nfspu_gpu_vertex *vertices,uint32_t vertex_count,
                       const uint32_t *indices,uint32_t index_count,nfspu_gpu_vertex *out,uint32_t flat,uint32_t physical) {
    if(primitive!=1&&primitive!=2)return 0;
    uint32_t count=indices?index_count:vertex_count,step=primitive==1?2:1,written=0;
    for(uint32_t i=0;i+step<=count;i+=step){
        uint32_t ia=indices?indices[i]:i,ib=indices?indices[i+step-1]:i+step-1;
        if(ia>=vertex_count||ib>=vertex_count)return 0;
        const nfspu_gpu_vertex *a=vertices+ia,*b=vertices+ib;
        if(!isfinite(a->x)||!isfinite(a->y)||!isfinite(b->x)||!isfinite(b->y))continue;
        nfspu_gpu_vertex q[4]={*a,*a,*b,*b};
        double sx=ui_scale[0],sy=ui_scale[1];
        double ax=physical?a->x:a->x*sx,ay=physical?a->y:a->y*sy;
        double bx=physical?b->x:b->x*sx,by=physical?b->y:b->y*sy;
        if(primitive==1){
            double dx=(double)b->x-a->x,dy=(double)b->y-a->y;
            if(physical){dx/=sx;dy/=sy;}
            double length=hypot(dx,dy);
            if(!length)continue;
            double nx=-dy/(2*length),ny=dx/(2*length);
            q[0].x=ax+nx*sx;q[0].y=ay+ny*sy;
            q[1].x=ax-nx*sx;q[1].y=ay-ny*sy;
            q[2].x=bx-nx*sx;q[2].y=by-ny*sy;
            q[3].x=bx+nx*sx;q[3].y=by+ny*sy;
            if(flat)for(unsigned j=0;j<4;j++)q[j].color=b->color;
        }else{
            for(unsigned j=0;j<4;j++){
                q[j].x=ax+(j==1||j==2?.5:-.5)*sx;
                q[j].y=ay+(j>=2?.5:-.5)*sy;
            }
        }
        static const unsigned triangle[]={0,1,2,0,2,3};
        for(unsigned j=0;j<6;j++)out[written++]=q[triangle[j]];
    }
    return written;
}
#endif
