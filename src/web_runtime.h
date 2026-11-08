#ifndef NFS5_WEB_RUNTIME_H
#define NFS5_WEB_RUNTIME_H
#include "web_memory.h"
#include "recomp_types.h"
void web_unsupported(uint32_t pc, const char *instruction);
void web_import(uint32_t index);
recomp_func_t web_import_lookup(uint32_t va);
extern const char *web_import_names[];
#endif
