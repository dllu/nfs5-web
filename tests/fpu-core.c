#include <stdint.h>
#include <string.h>
double g_st[8];
int64_t g_st_i64[8];
int g_fp_top;
#include "web_fpu.h"
void test_reset(void){memset(g_st,0,sizeof g_st);memset(g_st_i64,0,sizeof g_st_i64);g_fp_top=0;}
void test_push(double value){fp_push(value);}
void test_push_i64(uint32_t low,uint32_t high){fp_push_i64((int64_t)((uint64_t)high<<32|low));}
double test_pop(void){return fp_pop();}
void test_swap(unsigned index){fp_xch(index);}
void test_store(unsigned index,double value){FP_ST(index)=value;}
double test_value(unsigned index){return FP_ST(index);}
uint32_t test_low(unsigned index){return (uint32_t)FP_I64(index);}
uint32_t test_high(unsigned index){return (uint32_t)((uint64_t)FP_I64(index)>>32);}
int test_depth(void){return g_fp_top;}
