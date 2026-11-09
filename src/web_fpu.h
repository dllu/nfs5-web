/* Logical x87 registers backed by either a circular or shifted eight-slot
 * file. The double/int64 arrays and depth travel together in guest_cpu. */
#ifndef NFS5_WEB_FPU_H
#define NFS5_WEB_FPU_H
static inline unsigned web_fp_index(int depth,unsigned index) {
#ifdef WEB_FPU_CIRCULAR
    return (index-(uint32_t)depth)&7u;
#else
    (void)depth;return index;
#endif
}
#define FP_ST(i) (g_st[web_fp_index(g_fp_top,(i))])
#define FP_I64(i) (g_st_i64[web_fp_index(g_fp_top,(i))])

static inline void fp_push_impl(double *st,int *top,double value) {
#ifdef WEB_FPU_CIRCULAR
    ++*top;unsigned slot=web_fp_index(*top,0);
    st[slot]=value;g_st_i64[slot]=0;
#else
    for(int i=7;i>0;i--){st[i]=st[i-1];g_st_i64[i]=g_st_i64[i-1];}
    st[0]=value;g_st_i64[0]=0;++*top;
#endif
}
static inline double fp_pop_impl(double *st,int *top) {
#ifdef WEB_FPU_CIRCULAR
    unsigned slot=web_fp_index(*top,0);double value=st[slot];
    st[slot]=0;g_st_i64[slot]=0;--*top;
#else
    double value=st[0];
    for(int i=0;i<7;i++){st[i]=st[i+1];g_st_i64[i]=g_st_i64[i+1];}
    st[7]=0;g_st_i64[7]=0;--*top;
#endif
    return value;
}
#define fp_push(value) fp_push_impl(g_st,&g_fp_top,(value))
#define fp_pop() fp_pop_impl(g_st,&g_fp_top)
#define fp_push_i64(value) do { int64_t _web_fp_exact=(int64_t)(value); \
    fp_push((double)_web_fp_exact);FP_I64(0)=_web_fp_exact; } while(0)
#define fp_xch(i) do { double _web_fp_value=FP_ST(0);FP_ST(0)=FP_ST(i);FP_ST(i)=_web_fp_value; \
    int64_t _web_fp_exact=FP_I64(0);FP_I64(0)=FP_I64(i);FP_I64(i)=_web_fp_exact; } while(0)
#endif
