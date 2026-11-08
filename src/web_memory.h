#ifndef NFS5_WEB_MEMORY_H
#define NFS5_WEB_MEMORY_H
#include <stdint.h>
#include <stddef.h>
#define WEB_GUEST_SIZE (256u<<20)
#define MAP_VM_BASE 0x20000000u
#define MAP_VM_SIZE (512u<<20)
#define MAP_PAGE 4096u
extern ptrdiff_t g_mem_base;
extern uintptr_t web_map_pages[MAP_VM_SIZE/MAP_PAGE];
_Noreturn void web_invalid_address(uint32_t address);
static inline uintptr_t web_address_impl(uint32_t address) {
    if((address&0xE0000000u)==MAP_VM_BASE) {
        uintptr_t page=web_map_pages[(address-MAP_VM_BASE)/MAP_PAGE];
        if(!page)web_invalid_address(address);
        return page+(address&(MAP_PAGE-1));
    }
    return (uintptr_t)g_mem_base+address;
}
#define RECOMP_ADDRESS(va) web_address_impl((uint32_t)(va))
int web_guest_range(uint32_t address,uint32_t size);
#endif
