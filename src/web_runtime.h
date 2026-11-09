#ifndef NFS5_WEB_RUNTIME_H
#define NFS5_WEB_RUNTIME_H
#include "web_memory.h"
#include "recomp_types.h"
void web_unsupported(uint32_t pc, const char *instruction);
void web_import(uint32_t index);
recomp_func_t web_import_lookup(uint32_t va);
extern const char *web_import_names[];
extern float web_projection[3];
void web_projection_update(uint32_t width,uint32_t height);
uint32_t web_projection_bits(unsigned field);
uint32_t web_ui_layout(uint32_t width,uint32_t height,unsigned axis);
uint32_t web_ui_extent(unsigned axis);
int32_t web_ui_coordinate(int32_t value,unsigned axis);
uint32_t web_ui_mouse(uint32_t state);
void web_ui_begin(void);
void web_ui_end(void);
#endif
