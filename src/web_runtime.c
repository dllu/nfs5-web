/* Browser host for the original program's statically translated functions. */
#include "web_runtime.h"
#include <emscripten.h>
#include <emscripten/html5.h>
#include <stdarg.h>
#include <strings.h>
#include <time.h>
#include "win32_locale.h"
#include "web_projection.h"
#include "web_ui.h"

#define GUEST_SIZE WEB_GUEST_SIZE
#define HEAP_START (16u * 1024u * 1024u)
#define HEAP_LIMIT (224u * 1024u * 1024u)
#define STACK_TOP (GUEST_SIZE - 16u)
#define TRACE_SIZE 1024u

uint32_t g_eax, g_ecx, g_edx, g_esp, g_ebx, g_esi, g_edi, g_ebp;
double g_st[8];
int g_fp_top;
uint16_t g_fpu_cw = 0x37F;
uint16_t g_seg_cs, g_seg_ds, g_seg_es, g_seg_fs, g_seg_gs, g_seg_ss;
ptrdiff_t g_mem_base;
uint32_t g_fs_base, g_gs_base, g_es_base;
uint64_t g_mm[8];
xmm_t g_xmm[8];
uint32_t g_mxcsr = 0x1F80;
uint32_t g_cur_func;
uint32_t g_icall_trace[ICALL_TRACE_SIZE], g_icall_from[ICALL_TRACE_SIZE];
uint32_t g_icall_trace_idx, g_icall_count;
uint32_t g_enter_trace[RECOMP_ENTER_SIZE], g_enter_idx;
void (*recomp_projection_hook)(uint32_t camera);
void (*recomp_mode_hook)(uint32_t caller, uint32_t entry_esp);

static __thread jmp_buf stop;
static char error[512];
static uint32_t last_pc, first_pc, heap_next, next_tls, exception_filter;
static uint64_t calls;
static __thread uint32_t last_error;
static double deadline;
static double win_clock_origin;
static uint32_t intro_enabled=1;
static uint32_t intro_skipped;
void web_intro_config(uint32_t enabled){intro_enabled=enabled!=0;}
int web_skip_intro(void){if(!intro_enabled)intro_skipped++;return !intro_enabled;}
uint32_t web_intro_skipped(void){return intro_skipped;}
static uint32_t win_ticks(void) {
    /* Emscripten's monotonic clock includes performance.timeOrigin. Convert
     * elapsed time through uint64_t so the final 32-bit conversion wraps;
     * converting an epoch-sized double directly saturates in WebAssembly. */
    double elapsed=emscripten_get_now()-win_clock_origin;
    return (uint32_t)(uint64_t)(elapsed>0?elapsed:0);
}
static uint32_t registers[8];
static uint32_t import_info[10];
static uint8_t *entered;
static uint32_t entered_low, entered_span;
typedef struct { uint32_t address, size, span, kind, live; } guest_block;
static guest_block blocks[4096];
static uint32_t block_count;
static void thread_exit_code_import(void);
static recomp_func_t dinput_lookup(uint32_t address);
static recomp_func_t dsound_lookup(uint32_t address);
static recomp_func_t thrash_lookup(uint32_t address);
static void gimme_convert(void);
static void fail(uint32_t pc,const char *format,...);
static int mapping_name_exists(const char *name);
static int mapping_node_active(uint32_t node);
static int mapping_flush_node(uint32_t node);
static void map_flush_import(void);
static void memory_claim(uint32_t address,uint32_t size,uint32_t protection,uint32_t owner);

#include "win32_machine.h"

static void fail(uint32_t pc, const char *format, ...) {
    if (!fatal_pending) {
        last_pc = pc; error_thread = guest_tid();
        memcpy(error_import, import_info, sizeof import_info);
        va_list ap;
        va_start(ap, format);
        vsnprintf(error, sizeof error, format, ap);
        va_end(ap);
        fatal_pending = 1;
        wake_sync_waiters();notify_timer_waiters();
    }
    longjmp(stop, 1);
}

void web_unsupported(uint32_t pc, const char *instruction) {
    fail(pc, "Unsupported instruction at %08X: %s", pc, instruction);
}
_Noreturn void web_invalid_address(uint32_t address) {
    fail(g_cur_func,"Unmapped guest address %08X",address);
    abort();
}

void recomp_trace_enter(uint32_t va) {
    machine_abort_check();
    if (!calls) first_pc = va;
    if (va >= entered_low && va - entered_low < entered_span)
        entered[(va - entered_low) >> 3] |= 1u << ((va - entered_low) & 7);
    g_enter_trace[g_enter_idx++ & (TRACE_SIZE - 1)] = va;
    calls++;
    /* Run-until-Stop needs no JS clock crossing on every lifted call. */
    if (deadline != INFINITY && emscripten_get_now() > deadline)
        fail(va, "Execution budget reached at %08X", va);
}

static void check_loop(void) {
    machine_yield();
    if (deadline != INFINITY && emscripten_get_now() > deadline)
        fail(g_cur_func, "Loop budget reached at %08X", g_cur_func);
}

recomp_func_t recomp_lookup(uint32_t va) {
    uint32_t lo = 0, hi = recomp_dispatch_count;
    while (lo < hi) {
        uint32_t mid = lo + (hi - lo) / 2;
        if (recomp_dispatch_table[mid].address < va) lo = mid + 1;
        else hi = mid;
    }
    return lo < recomp_dispatch_count && recomp_dispatch_table[lo].address == va
        ? recomp_dispatch_table[lo].func : NULL;
}

#include "web_analog.h"
recomp_func_t recomp_lookup_manual(uint32_t va) {
    recomp_func_t analog=analog_lookup(va);if(analog)return analog;
    if(va==0xF7000000u)return gimme_convert;
    if(va==0xF6000000)return map_flush_import;
    if (va == 0xF1000000) return thread_exit_code_import;
    if (va == 0xF1000010) return timer_dispatch;
    recomp_func_t fn = dinput_lookup(va);
    if (!fn) fn = dsound_lookup(va);
    return fn ? fn : thrash_lookup(va);
}
recomp_func_t recomp_lookup_import(uint32_t va) {
    recomp_func_t fn = web_import_lookup(va);
    if (!fn) fail(g_cur_func, "Untranslated call to %08X from %08X", va, g_cur_func);
    return fn;
}

static uint32_t argument(unsigned i) { return MEM32(g_esp + 4 + i * 4); }
static void result(uint32_t value, unsigned argc) { g_eax = value; g_esp += 4 + argc * 4; }
static guest_block *block_slot(void) {
    for (uint32_t i = 0; i < block_count; i++) if (!blocks[i].span) return &blocks[i];
    if (block_count == 4096) fail(g_cur_func, "Guest allocation table exhausted");
    return &blocks[block_count++];
}

static guest_block *find_block(uint32_t address, uint32_t kind) {
    for (uint32_t i = 0; i < block_count; i++)
        if (blocks[i].live && blocks[i].address == address && blocks[i].kind == kind) return &blocks[i];
    return NULL;
}

static void heap_snapshot(uint32_t stats[12]) {
    memset(stats, 0, 12 * sizeof(uint32_t));
    stats[0] = HEAP_START; stats[1] = heap_next; stats[2] = HEAP_LIMIT;
    stats[7] = HEAP_LIMIT - heap_next; stats[10] = block_count;
    for (uint32_t i = 0; i < block_count; i++) {
        const guest_block *block = &blocks[i];
        if (!block->span) continue;
        if (block->live) {
            stats[3] += block->size; stats[4] += block->span; stats[8]++;
        } else {
            stats[5] += block->span; stats[9]++;
            if (block->span > stats[6]) stats[6] = block->span;
        }
    }
    stats[11] = heap_next - HEAP_START - stats[4] - stats[5];
}
static void heap_exhausted(uint32_t size) {
    uint32_t stats[12]; heap_snapshot(stats);
    uint32_t largest = stats[6] > stats[7] ? stats[6] : stats[7];
    fail(g_cur_func, "Guest heap exhausted (%u bytes; %u bytes free, largest span %u, live %u)",
         size, stats[5] + stats[7], largest, stats[4]);
}

static uint32_t allocate_kind(uint32_t size, uint32_t alignment, uint32_t kind) {
    uint32_t mask = kind == 2 ? 4095 : 15;
    if (size > HEAP_LIMIT - mask) heap_exhausted(size);
    uint32_t span = ((size ? size : 1) + mask) & ~mask;
    guest_block *best = NULL;
    for (uint32_t i = 0; i < block_count; i++) {
        guest_block *block = &blocks[i];
        if (block->live || block->span < span) continue;
        uint32_t address = (block->address + alignment - 1) & ~(alignment - 1);
        if (address - block->address > block->span - span) continue;
        if (!best || block->span < best->span ||
            (block->span == best->span && block->address < best->address)) best = block;
    }
    uint32_t address;
    guest_block *block = best;
    if (best) {
        address = (best->address + alignment - 1) & ~(alignment - 1);
        uint32_t before = address - best->address, after = best->span - before - span;
        if (before) *block_slot() = (guest_block){.address = best->address, .span = before};
        if (after) *block_slot() = (guest_block){.address = address + span, .span = after};
    } else {
        address = (heap_next + alignment - 1) & ~(alignment - 1);
        if (span > HEAP_LIMIT - HEAP_START || address > HEAP_LIMIT - span) heap_exhausted(size);
        if (address > heap_next) *block_slot() = (guest_block){.address = heap_next, .span = address - heap_next};
        block = block_slot();
        heap_next = address + span;
    }
    *block = (guest_block){address, size, span, kind, 1};
    memory_claim(address,span,4,kind==2?address:1);
    memset((void *)ADDR(address), 0, span);
    return address;
}

static void release_block(guest_block *block) {
    if(block->kind==2)memory_claim(block->address,block->span,0,0);
    uint32_t address = block->address, span = block->span;
    /* Free extents are disjoint and never touch: at most one neighbor on
     * each side. Preserve metadata slots of every live allocation. */
    for (uint32_t i = 0; i < block_count; i++) {
        guest_block *neighbor = &blocks[i];
        if (neighbor == block || neighbor->live || !neighbor->span) continue;
        if (neighbor->address + neighbor->span == address) {
            address = neighbor->address; span += neighbor->span;
        } else if (address + span == neighbor->address) span += neighbor->span;
        else continue;
        *neighbor = (guest_block){0};
    }
    if (address + span == heap_next) {
        heap_next = address; *block = (guest_block){0};
    } else *block = (guest_block){.address = address, .span = span};
    while (block_count && !blocks[block_count - 1].span) block_count--;
}

static uint32_t allocate(uint32_t size) {
    return allocate_kind(size, 16, 1);
}

uint32_t web_ui_mouse(uint32_t state) {
    if(!state||(ui_size[0]==ui_pixels[0]&&ui_size[1]==ui_pixels[1]))return state;
    if(!ui_mouse_buffer)ui_mouse_buffer=allocate(20);
    memcpy((void*)ADDR(ui_mouse_buffer),(const void*)ADDR(state),20);
    MEM32(ui_mouse_buffer+4)=web_ui_coordinate((int32_t)MEM32(state+4),0);
    MEM32(ui_mouse_buffer+8)=web_ui_coordinate((int32_t)MEM32(state+8),1);
    return ui_mouse_buffer;
}

static int dll_equal(const char *a, size_t an, const char *b, size_t bn) {
    if (an > 4 && !strncasecmp(a + an - 4, ".dll", 4)) an -= 4;
    if (bn > 4 && !strncasecmp(b + bn - 4, ".dll", 4)) bn -= 4;
    return an == bn && !strncasecmp(a, b, an);
}

static uint32_t module_handle(const char *name) {
    if (!name || !strcasecmp(name, "nfs5.exe")) return 0x400000;
    for (uint32_t i = 0; web_import_lookup(0xF0000000u + i * 16); i++) {
        const char *full = web_import_names[i];
        if (dll_equal(name, strlen(name), full, (size_t)(strchr(full, '!') - full)))
            return 0x70000000u + i * 16;
    }
    return 0;
}

#include "win32_sync.h"
#include "win32_threads.h"
#include "win32_timers.h"
#include "win32_dinput.h"
#include "win32_dsound.h"
#include "web_detail.h"
#include "web_audio.h"
#include "win32_paths.h"
#include "win32_files.h"
#include "win32_mapping.h"
#include "gimme.h"
#include "win32_memory.h"
#include "win32_windows.h"
#include "win32_registry.h"
#include "win32_environment.h"
#include "win32_collation.h"
#include "win32_time.h"
#include "web_gpu.h"
#include "web_ui_primitives.h"
#include "thrash_driver.h"

static void thread_exit_code_import(void) {
    sync_object *object = sync_get(argument(0));
    guest_thread *thread = argument(0) == 0xFFFFFFFE ? &guest_threads[current_thread] :
        object && object->kind == SYNC_THREAD ? object->thread : NULL;
    if (!thread) { last_error = 6; result(0, 2); return; }
    if (!argument(1)) { last_error = 87; result(0, 2); return; }
    MEM32(argument(1)) = thread->done ? thread->exit_code : 259;
    result(1, 2);
}

void web_import(uint32_t index) {
    machine_yield();
    import_info[0] = index; import_info[1] = g_cur_func;
    for (unsigned i = 0; i < 8; i++) import_info[i + 2] =
        g_esp < GUEST_SIZE - 4 * (i + 2) ? argument(i) : 0;
    const char *full = web_import_names[index];
    const char *name = strchr(full, '!') + 1;
    /* This is Verok's patch version, not the Win32 operating-system version. */
    if(!strcmp(full,"NFS5.dll!GetVersion")){result(0x60001,0);return;}
    if (!strncmp(full, "NFS5.dll!", 9))
        fail(g_cur_func, "Unimplemented Windows import: %s (caller %08X)", full, g_cur_func);
    if (memory_import(name)) return;
    if (mapping_import(name)) return;
    if (fs_import(name)) return;
    if (sync_import(name)) return;
    if (timer_import(full)) return;
    if (dinput_import(full)) return;
    if (dsound_import(full)) return;
    if (path_import(name)) return;
    if (!strncmp(full, "USER32.dll!", 11) && win_import(name)) return;
    if (!strncmp(full, "GDI32.dll!", 10) && win_gdi_import(name)) return;
    if (!strncmp(full, "ADVAPI32.dll!", 13) && reg_import(name)) return;
    if (environment_import(name)) return;
    if (collation_import(name)) return;
    if (time_import(full)) return;
    /* There is no network subsystem in this single-player host. The original
     * game handles this documented startup failure and omits its TCP provider. */
    if (!strcmp(full, "WSOCK32.dll!WSAStartup")) { result(10091, 2); return; }
    if (!strcmp(full, "USER32.dll!GetCursorPos")) {
        uint32_t point = argument(0);
        if (!point) { last_error = 87; result(0, 1); return; }
        MEM32(point) = (uint32_t)di_cursor[0]; MEM32(point + 4) = (uint32_t)di_cursor[1]; result(1, 1); return;
    }
    if (!strcmp(full, "USER32.dll!SetCursorPos")) {
        di_cursor[0] = (int32_t)argument(0); di_cursor[1] = (int32_t)argument(1); result(1, 2); return;
    }
    if (!strcmp(full, "USER32.dll!GetKeyboardType")) {
        uint32_t type = argument(0); result(type == 0 ? 4 : type == 2 ? 12 : 0, 1); return;
    }
    if (!strcmp(full, "USER32.dll!GetKeyState") || !strcmp(full, "USER32.dll!GetAsyncKeyState")) {
        result(di_key_state(argument(0), !strcmp(name, "GetAsyncKeyState")), 1); return;
    }
    if (!strcmp(full, "USER32.dll!CharUpperA")) {
        uint32_t value = argument(0);
        if (!(value >> 16)) { result(cp1252_case((uint8_t)value, 1), 1); return; }
        for (uint32_t p = value; MEM8(p); p++) MEM8(p) = cp1252_case(MEM8(p), 1);
        result(value, 1); return;
    }
    if (!strcmp(name, "GetVersion")) { result(0x80000104u, 0); return; }
    if (!strcmp(name, "GetVersionExA")) {
        uint32_t out = argument(0);
        if (!out || MEM32(out) != 148) { last_error = 87; result(0, 1); return; }
        memset((void *)ADDR(out + 4), 0, 144);
        MEM32(out + 4) = 4; MEM32(out + 8) = 1; MEM32(out + 16) = 1;
        result(1, 1); return;
    }
    if (!strcmp(name, "GetLastError")) { result(last_error, 0); return; }
    if (!strcmp(name, "GlobalMemoryStatus")) {
        uint32_t p=argument(0),available=HEAP_LIMIT-heap_next;
        for(unsigned i=0;i<block_count;i++)if(!blocks[i].live)available+=blocks[i].span;
        available=available>map_allocated?available-map_allocated:0;
        /* Report the bounded guest machine, rather than the browser host's RAM. */
        if(p){uint32_t status[]={32,(uint32_t)((uint64_t)(GUEST_SIZE-available)*100u/GUEST_SIZE),GUEST_SIZE,available,GUEST_SIZE,available,GUEST_SIZE,available};
            memcpy((void*)ADDR(p),status,sizeof status);}
        result(0,1);return;
    }
    if (!strcmp(name, "DisableThreadLibraryCalls")) {
        uint32_t module=argument(0);
        int valid=module==THRASH_MODULE || module==GIMME_MODULE || (module>=0x70000000 && module<0x70010000 && !(module&15) && web_import_lookup(0xF0000000+module-0x70000000));
        if(!valid)last_error=6;
        result(valid,1);return;
    }
    if(!strcmp(name,"FreeLibrary")) {
        uint32_t handle=argument(0);
        int valid=handle==THRASH_MODULE||handle==GIMME_MODULE||(handle>=0x70000000&&handle<0x70010000&&!(handle&15)&&web_import_lookup(0xF0000000+handle-0x70000000));
        if(!valid)last_error=6;
        /* Static host service bindings remain resident for the process. */
        result(valid,1);return;
    }
    if (!strcmp(name, "SetLastError")) { last_error = argument(0); result(0, 1); return; }
    if (!strcmp(name, "SetUnhandledExceptionFilter")) {
        uint32_t previous = exception_filter; exception_filter = argument(0);
        result(previous, 1); return;
    }
    if (!strcmp(name, "GetModuleHandleA") || !strcmp(name, "LoadLibraryA")) {
        const char *library = argument(0) ? (const char *)ADDR(argument(0)) : NULL;
        if (library && (!strcasecmp(library, "TAPI32.dll") || !strcasecmp(library, "TAPI32"))) {
            last_error = 126; result(0, 1); return;
        }
        uint32_t handle = module_handle(library);
        if (!handle) handle = thrash_module(library);
        if (!handle) handle = gimme_module(library);
        if (!handle) {
            if (!strcmp(name, "LoadLibraryA")) fail(g_cur_func, "Dynamic library needs porting: %s", (const char *)ADDR(argument(0)));
            last_error = 126;
        }
        result(handle, 1); return;
    }
    if (!strcmp(name, "GetProcAddress")) {
        uint32_t handle = argument(0), symbol = argument(1);
        if(handle==GIMME_MODULE){
            uint32_t function=symbol==1||(symbol>=0x10000&&!strcmp((const char*)ADDR(symbol),"ConvertFile"))?GIMME_CONVERT:0;
            if(!function)last_error=127;
            result(function,2);return;
        }
        if (handle == THRASH_MODULE) {
            uint32_t function = thrash_proc(symbol); if (!function) last_error = 127;
            result(function, 2); return;
        }
        if (handle >= 0x70000000u && handle < 0x70010000u && !(handle & 15) && symbol >= 0x10000 &&
            web_import_lookup(0xF0000000u + handle - 0x70000000u)) {
            const char *dll = web_import_names[(handle - 0x70000000u) / 16];
            size_t dll_length = (size_t)(strchr(dll, '!') - dll);
            if (dll_equal(dll, dll_length, "KERNEL32", 8) && !strcmp((const char *)ADDR(symbol), "GetExitCodeThread")) {
                result(0xF1000000, 2); return;
            }
            if(dll_equal(dll,dll_length,"KERNEL32",8)&&!strcmp((const char*)ADDR(symbol),"FlushViewOfFile")){result(0xF6000000,2);return;}
            for (uint32_t i = 0; web_import_lookup(0xF0000000u + i * 16); i++) {
                const char *full = web_import_names[i], *separator = strchr(full, '!');
                if (dll_equal(dll, dll_length, full, (size_t)(separator - full)) &&
                    !strcmp(separator + 1, (const char *)ADDR(symbol))) {
                    result(0xF0000000u + i * 16, 2); return;
                }
            }
        }
        last_error = 127; result(0, 2); return;
    }
    if (!strcmp(name, "GetCurrentProcess")) { result(0xFFFFFFFF, 0); return; }
    if (!strcmp(name, "ExitProcess")) {
        /* End the guest without terminating the browser/Node host. Every
         * native guest stack unwinds at its next machine acquisition/check. */
        process_exit_code = argument(0); process_exited = 1;
        for (unsigned i = 0; i < 8; i++)
            if (guest_threads[i].used && !guest_threads[i].done)
                guest_threads[i].exit_code = process_exit_code;
        wake_sync_waiters(); notify_timer_waiters(); gpu_wake_waiters();
        longjmp(stop, 4);
    }
    if (!strcmp(name, "GetDriveTypeA")) {
        const char *path = argument(0) ? (const char *)ADDR(argument(0)) : path_cwd;
        char drive = path[0] >= 'a' && path[0] <= 'z' ? path[0] - 32 : path[0];
        result(drive == 'C' ? 3 : drive == 'D' ? 5 : 1, 1); return;
    }
    if (!strcmp(name, "GetSystemInfo")) {
        uint32_t info = argument(0);
        memset((void *)ADDR(info), 0, 36);
        MEM32(info + 4) = 4096; /* page size */
        MEM32(info + 8) = 0x10000; MEM32(info + 12) = MAP_VM_BASE+MAP_VM_SIZE-1;
        MEM32(info + 16) = 1; MEM32(info + 20) = 1; /* serialized guest CPU */
        MEM32(info + 24) = 586; MEM32(info + 28) = 65536;
        MEM16(info + 32) = 6;
        result(0, 1); return;
    }
    if (!strcmp(name, "GetCurrentProcessId")) { result(1, 0); return; }
    if (!strcmp(name, "GetCurrentThreadId")) { result(guest_tid(), 0); return; }
    if (!strcmp(name, "GetTickCount") || !strcmp(name, "timeGetTime")) { result(win_ticks(), 0); return; }
    if (!strcmp(full, "WINMM.dll!timeGetDevCaps")) {
        if (!argument(0) || argument(1) < 8) { result(97, 2); return; }
        MEM32(argument(0)) = 1; MEM32(argument(0) + 4) = 1000; result(0, 2); return;
    }
    if (!strcmp(full, "WINMM.dll!joyGetNumDevs")) { result(0, 0); return; }
    if (!strcmp(full, "WINMM.dll!timeBeginPeriod") || !strcmp(full, "WINMM.dll!timeEndPeriod")) {
        result(argument(0) >= 1 && argument(0) <= 1000 ? 0 : 97, 1); return;
    }
    if (!strcmp(name, "QueryPerformanceFrequency")) { MEM64(argument(0)) = 1000000; result(1, 1); return; }
    if (!strcmp(name, "QueryPerformanceCounter")) { MEM64(argument(0)) = (uint64_t)((emscripten_get_now()-win_clock_origin) * 1000); result(1, 1); return; }
    if (!strcmp(name, "GetProcessHeap")) { result(1, 0); return; }
    if (!strcmp(name, "HeapCreate")) { result(1, 3); return; }
    if (!strcmp(name, "HeapAlloc")) { result(allocate(argument(2)), 3); return; }
    if (!strcmp(name, "HeapSize") || !strcmp(name, "HeapFree")) {
        guest_block *block = find_block(argument(2), 1);
        if (!block) { last_error = 87; result(!strcmp(name, "HeapSize") ? 0xFFFFFFFF : 0, 3); return; }
        if (!strcmp(name, "HeapSize")) { result(block->size, 3); return; }
        release_block(block); result(1, 3); return;
    }
    if (!strcmp(name, "HeapReAlloc")) {
        guest_block *block = find_block(argument(2), 1);
        uint32_t size = argument(3), flags = argument(1);
        if (!block) { last_error = 87; result(0, 4); return; }
        if (size <= block->span) {
            if (size > block->size && (flags & 8)) memset((void *)ADDR(block->address + block->size), 0, size - block->size);
            block->size = size; result(block->address, 4); return;
        }
        if (flags & 0x10) { last_error = 8; result(0, 4); return; }
        uint32_t address = allocate(size);
        memcpy((void *)ADDR(address), (void *)ADDR(block->address), block->size);
        release_block(block); result(address, 4); return;
    }
    if (!strcmp(name, "TlsAlloc")) {
        if (next_tls == 256) { last_error = 8; result(0xFFFFFFFF, 0); return; }
        result(next_tls++, 0); return;
    }
    if (!strcmp(name, "TlsSetValue")) {
        if (argument(0) >= next_tls) { last_error = 87; result(0, 2); return; }
        MEM32(g_fs_base + 0x1000 + argument(0) * 4) = argument(1); result(1, 2); return;
    }
    if (!strcmp(name, "TlsGetValue")) {
        if (argument(0) >= next_tls) { last_error = 87; result(0, 1); return; }
        last_error = 0; result(MEM32(g_fs_base + 0x1000 + argument(0) * 4), 1); return;
    }
    if (!strcmp(name, "GetStartupInfoA")) {
        uint32_t info = argument(0);
        memset((void *)ADDR(info), 0, 68); MEM32(info) = 68;
        result(0, 1); return;
    }
    if (!strcmp(name, "GetCommandLineA")) { result(0xB000, 0); return; }
    if (!strcmp(name, "GetStdHandle")) { result(0x100u + (0u - argument(0) - 10u), 1); return; }
    if (!strcmp(name, "GetFileType")) { result(argument(0) >= 0x100 && argument(0) <= 0x102 ? 2 : 0, 1); return; }
    if (!strcmp(name, "SetHandleCount")) { result(argument(0), 1); return; }
    if (!strcmp(name, "GetACP")) { result(1252, 0); return; }
    if (!strcmp(name, "GetOEMCP")) { result(437, 0); return; }
    if (!strcmp(name, "GetCPInfo")) {
        if (argument(0) != 0 && argument(0) != 1252) fail(g_cur_func, "GetCPInfo codepage %u needs implementation", argument(0));
        uint32_t info = argument(1);
        memset((void *)ADDR(info), 0, 20); MEM32(info) = 1; MEM8(info + 4) = '?';
        result(1, 2); return;
    }
    if (!strcmp(name, "GetModuleFileNameA")) {
        if (argument(0) && argument(0) != 0x400000 && argument(0) != THRASH_MODULE)
            fail(g_cur_func, "Non-executable module filename needs implementation");
        uint32_t output = argument(1), size = argument(2);
        const char *path = argument(0) == THRASH_MODULE ? "C:\\nfs5\\Drivers\\opengl3\\opengl3z.dll" : "C:\\nfs5\\nfs5.exe";
        uint32_t length = (uint32_t)strlen(path);
        if (size <= length) { last_error = 122; result(0, 3); return; }
        memcpy((void *)ADDR(output), path, length + 1);
        result(length, 3); return;
    }
    /* Match the advertised Win95 ABI: the CRT detects these failures and
     * initializes its ANSI locale using GetStringTypeA instead. */
    if (!strcmp(name, "GetStringTypeW")) { last_error = 120; result(0, 4); return; }
    if (!strcmp(name, "LCMapStringW") || !strcmp(name, "CompareStringW")) { last_error = 120; result(0, 6); return; }
    if (!strcmp(name, "GetStringTypeA")) {
        uint32_t input = argument(2), output = argument(4);
        int32_t length = (int32_t)argument(3);
        if (argument(1) != 1) fail(g_cur_func, "GetStringTypeA type %u needs implementation", argument(1));
        if (!input || !output || length < -1) { last_error = 87; result(0, 5); return; }
        if (length == -1) length = (int32_t)strlen((const char *)ADDR(input)) + 1;
        for (int32_t i = 0; i < length; i++) MEM16(output + i * 2) = cp1252_type(MEM8(input + i));
        result(1, 5); return;
    }
    if (!strcmp(name, "LCMapStringA")) {
        uint32_t flags = argument(1), input = argument(2), output = argument(4), capacity = argument(5);
        int32_t length = (int32_t)argument(3);
        if (flags != 0x100 && flags != 0x200)
            fail(g_cur_func, "LCMapStringA flags %08X need implementation", flags);
        if (!input || length < -1) { last_error = 87; result(0, 6); return; }
        if (length == -1) length = (int32_t)strlen((const char *)ADDR(input)) + 1;
        if (capacity && capacity < (uint32_t)length) { last_error = 122; result(0, 6); return; }
        if (capacity) for (int32_t i = 0; i < length; i++) MEM8(output + i) = cp1252_case(MEM8(input + i), flags == 0x200);
        result((uint32_t)length, 6); return;
    }
    if (!strcmp(name, "MultiByteToWideChar")) {
        uint32_t codepage = argument(0), input = argument(2), output = argument(4), capacity = argument(5);
        int32_t length = (int32_t)argument(3);
        if (codepage != 0 && codepage != 1252) fail(g_cur_func, "MultiByteToWideChar codepage %u needs implementation", codepage);
        if (!input || length < -1) { last_error = 87; result(0, 6); return; }
        if (length == -1) length = (int32_t)strlen((const char *)ADDR(input)) + 1;
        if (capacity && capacity < (uint32_t)length) { last_error = 122; result(0, 6); return; }
        if (capacity) for (int32_t i = 0; i < length; i++) MEM16(output + i * 2) = cp1252_decode(MEM8(input + i));
        result((uint32_t)length, 6); return;
    }
    if (!strcmp(name, "WideCharToMultiByte")) {
        uint32_t codepage = argument(0), input = argument(2), output = argument(4), capacity = argument(5);
        int32_t length = (int32_t)argument(3);
        if (codepage != 0 && codepage != 1252 && codepage != 65001)
            fail(g_cur_func, "WideCharToMultiByte codepage %u needs implementation", codepage);
        if (!input || length < -1 || (capacity && !output)) { last_error = 87; result(0, 8); return; }
        if (length == -1) { length = 0; while (MEM16(input + length * 2)) length++; length++; }
        if (capacity && capacity < (uint32_t)length) { last_error = 122; result(0, 8); return; }
        uint32_t used_default = 0;
        for (int32_t i = 0; i < length; i++) {
            uint16_t value = MEM16(input + i * 2);
            if (codepage == 65001 && value > 127) fail(g_cur_func, "UTF-8 text conversion needs implementation");
            int byte = cp1252_encode(value);
            if (byte < 0) { byte = argument(6) ? MEM8(argument(6)) : '?'; used_default = 1; }
            if (capacity) MEM8(output + i) = (uint8_t)byte;
        }
        if (argument(7)) MEM32(argument(7)) = used_default;
        result((uint32_t)length, 8); return;
    }
    fail(g_cur_func, "Unimplemented Windows import: %s (caller %08X)", full, g_cur_func);
}

/* No silent exception emulation: report the first path needing a real bridge. */
void recomp_eh_push(recomp_ehframe_t *f) { (void)f; fail(g_cur_func, "Guest C++ exception frame needs implementation"); }
void recomp_eh_pop(recomp_ehframe_t *f) { (void)f; }
recomp_ehframe_t *recomp_eh_owner(uint32_t esp) { (void)esp; fail(g_cur_func, "Guest longjmp needs implementation"); return NULL; }
void recomp_eh_resume(recomp_ehframe_t *f, uint32_t resume) { (void)f; (void)resume; fail(g_cur_func, "Guest exception resume needs implementation"); }
void recomp_dump_trace(const char *why) { (void)why; }

uint32_t web_init(void) {
    stop_guest_workers();
    detail_reset();
    audio_reset();
    if (!g_mem_base) g_mem_base = (ptrdiff_t)calloc(1, GUEST_SIZE);
    else memset((void *)g_mem_base, 0, GUEST_SIZE);
    if (!g_mem_base) return 0;
    web_projection_update(640,480);
    web_ui_update(640,480);ui_draw_depth=ui_stroke_depth=ui_mouse_buffer=0;
    entered_low = recomp_dispatch_table[0].address;
    entered_span = recomp_dispatch_table[recomp_dispatch_count - 1].address - entered_low + 1;
    if (!entered) entered = calloc(1, (entered_span + 7) / 8);
    else memset(entered, 0, (entered_span + 7) / 8);
    if (!entered) return 0;
    g_eax = g_ecx = g_edx = g_ebx = g_esi = g_edi = g_ebp = 0;
    g_esp = STACK_TOP;
    g_fs_base = 0x8000;
    MEM32(g_fs_base) = 0xFFFFFFFF;
    MEM32(g_fs_base + 4) = STACK_TOP;
    MEM32(g_fs_base + 8) = STACK_TOP - 0x400000;
    MEM32(g_fs_base + 0x18) = g_fs_base;
    MEM32(g_fs_base + 0x30) = 0xA000;
    memcpy((void *)ADDR(0xB000), "C:\\nfs5\\nfs5.exe", 17);
    heap_next = HEAP_START;
    block_count = 0; memset(blocks, 0, sizeof blocks);
    g_enter_idx = calls = g_icall_count = g_icall_trace_idx = 0;
    win_clock_origin=emscripten_get_now();
    intro_enabled=1;intro_skipped=0;
    next_tls = last_error = g_backedges = g_cur_func = exception_filter = 0;
    memset(sync_objects, 0, sizeof sync_objects); memset(sync_handles, 0, sizeof sync_handles);
    memset(sync_waiters, 0, sizeof sync_waiters);
    memset(guest_threads, 0, sizeof guest_threads);
    memset(critical_sections, 0, sizeof critical_sections);
    memset(timers, 0, sizeof timers); timer_worker = 0; next_timer_id = 1;
    path_reset();
    mapping_reset();memory_reset();fs_reset();
    memset(ds_devices, 0, sizeof ds_devices); memset(ds_buffers, 0, sizeof ds_buffers); memset(ds_data, 0, sizeof ds_data);
    ds_device_table = ds_buffer_table = ds_mixed_frames = 0;
    win_reset();
    thrash_reset(); gpu_reset();
    reg_reset();
    memset(process_environment, 0, sizeof process_environment);
    memset(di_devices, 0, sizeof di_devices); di_root_table = di_device_table = di_sequence = 0;
    memset(di_keys, 0, sizeof di_keys); memset(di_pressed, 0, sizeof di_pressed); memset(di_toggled, 0, sizeof di_toggled);
    memset(di_mouse, 0, sizeof di_mouse); memset(di_cursor, 0, sizeof di_cursor); di_buttons = 0; di_focused = 1;
    analog_reset();
    timer_created = timer_fired = timer_callbacks = timer_killed = 0;
    guest_threads[0].used = 1; guest_threads[0].id = 1; guest_threads[0].object = 0xFFFFFFFF; current_thread = 0;
    next_thread_id = 2; cancel_workers = fatal_pending = 0; process_exited = process_exit_code = 0;
    atomic_store(&stop_requested,0);error_thread = 0;
    g_flag_k = g_flag_a = g_flag_b = g_flag_cf = 0;
    memset(g_st, 0, sizeof g_st);
    memset(g_st_i64,0,sizeof g_st_i64);
    g_fp_top = 0; g_fpu_cw = 0x37F;
    error[0] = 0; last_pc = first_pc = 0;
    memset(import_info, 0, sizeof import_info); import_info[0] = 0xFFFFFFFF;
    recomp_yield_hook = check_loop;
    cpu_save();
    return (uint32_t)g_mem_base;
}

static int run_guest(uint32_t entry, uint32_t milliseconds) {
    machine_acquire();
    ui_draw_depth=ui_stroke_depth=0;
    if (!current_thread) {
        error[0] = 0; fatal_pending = 0; cancel_workers = 0;
        process_exited = process_exit_code = 0;
    }
    deadline = milliseconds?emscripten_get_now()+milliseconds:INFINITY;
    int stopped = setjmp(stop);
    if (!stopped) {
        /* Verok's 005A2DF4 startup trampoline loads driver [ENV] before CRT
         * environment snapshots. This image enters that CRT at 005A2D1A. */
        if(entry==0x005A2D1Au)thrash_load_environment();
        recomp_func_t fn = recomp_lookup(entry);
        if (!fn) fn = recomp_lookup_manual(entry);
        if (!fn) fn = web_import_lookup(entry);
        if (!fn) fail(entry, "Entry %08X was not translated", entry);
        g_esp -= 4; MEM32(g_esp) = RECOMP_RETADDR;
        fn();
    }
    if (stopped) sync_clear_waiters(guest_tid());
    machine_release();
    if (stopped && !current_thread) stop_guest_workers();
    return stopped != 0 && stopped != 4;
}
int web_run(uint32_t entry,uint32_t milliseconds) {
    atomic_store(&stop_requested,0);return run_guest(entry,milliseconds);
}

static struct {
    guest_cpu initial, final;
    uint32_t entry, milliseconds;
    uint32_t initial_error,final_error;
    pthread_t native;
    _Atomic int status;
} asynchronous_run;

static void *asynchronous_main(void *unused) {
    (void)unused;
    ui_draw_depth=ui_stroke_depth=0;
    current_thread = 0; cpu = asynchronous_run.initial; last_error = asynchronous_run.initial_error;
    int status = run_guest(asynchronous_run.entry, asynchronous_run.milliseconds);
    stop_guest_workers();
    asynchronous_run.final = cpu;
    asynchronous_run.final_error=last_error;
    atomic_store(&asynchronous_run.status, status ? 3 : 2);
    return NULL;
}

int web_start(uint32_t entry, uint32_t milliseconds) {
    if (atomic_load(&asynchronous_run.status)) return 1;
    atomic_store(&stop_requested,0);
    asynchronous_run.initial = cpu;
    asynchronous_run.initial_error=last_error;
    asynchronous_run.entry = entry; asynchronous_run.milliseconds = milliseconds;
    atomic_store(&asynchronous_run.status, 1);
    if (pthread_create(&asynchronous_run.native, NULL, asynchronous_main, NULL)) {
        atomic_store(&asynchronous_run.status, 0); return 2;
    }
    return 0;
}

int web_async_status(void) { return atomic_load(&asynchronous_run.status); }
int web_stop(void) {
    if(atomic_load(&asynchronous_run.status)!=1)return 0;
    atomic_store(&stop_requested,1);wake_sync_waiters();notify_timer_waiters();gpu_wake_waiters();return 1;
}

int web_async_finish(void) {
    int status = atomic_load(&asynchronous_run.status);
    if (status < 2) return -1;
    pthread_join(asynchronous_run.native, NULL);
    cpu = asynchronous_run.final;
    last_error=asynchronous_run.final_error;
    atomic_store(&asynchronous_run.status, 0);
    return status == 3;
}

int web_call(uint32_t entry, uint32_t a, uint32_t b, uint32_t c, uint32_t d) {
    cpu.r[4] = STACK_TOP - 16;
    MEM32(cpu.r[4]) = a; MEM32(cpu.r[4] + 4) = b;
    MEM32(cpu.r[4] + 8) = c; MEM32(cpu.r[4] + 12) = d;
    return web_run(entry, 2000);
}

uint32_t *web_registers(void) {
    memcpy(registers, cpu.r, sizeof registers);
    return registers;
}
uint32_t *web_trace(void) { return g_enter_trace; }
double web_trace_count(void) {
    /* Preserve a JS Number across long runs; exported i32 counters become
     * negative at 2^31 entries and the ring cursor itself wraps at 2^32. */
    machine_acquire();double count=(double)calls;machine_release();return count;
}
const char *web_error(void) { return error; }
uint32_t web_process_exited(void) { return process_exited; }
uint32_t web_exit_code(void) { return process_exit_code; }
uint32_t web_last_pc(void) { return last_pc; }
uint32_t web_first_pc(void) { return first_pc; }
uint32_t web_error_thread(void) { return error_thread; }
int web_has_entered(uint32_t va) {
    return va >= entered_low && va - entered_low < entered_span &&
        (entered[(va - entered_low) >> 3] & (1u << ((va - entered_low) & 7))) != 0;
}
uint32_t *web_last_import(void) { return fatal_pending ? error_import : cpu.import; }
uint32_t web_heap(void) { return heap_next; }
uint32_t *web_heap_stats(void) {
    static uint32_t stats[12];machine_acquire();heap_snapshot(stats);machine_release();return stats;
}
uint32_t web_memory_size(void) { return GUEST_SIZE; }
uint32_t web_pointer(uint32_t address,uint32_t size) {
    machine_acquire();uint32_t pointer=web_guest_range(address,size)?(uint32_t)ADDR(address):0;machine_release();return pointer;
}
uint32_t *web_mapping_stats(void) {
    static uint32_t stats[6];machine_acquire();memset(stats,0,sizeof stats);stats[0]=map_allocated;
    for(unsigned i=0;i<64;i++)stats[1]+=map_stores[i].data!=NULL;
    for(unsigned i=0;i<128;i++)stats[2]+=map_objects[i].refs!=0;
    for(unsigned i=0;i<256;i++){stats[3]+=map_handles[i].object!=0;stats[4]+=map_views[i].base!=0;stats[5]+=map_views[i].copy!=NULL;}
    machine_release();return stats;
}
void web_set_register(uint32_t index, uint32_t value) {
    if (index < 8) cpu.r[index] = value;
}
double web_float_result(void) { return cpu.st[web_fp_index(cpu.fp_top,0)]; }
void web_input_key(uint32_t scan, uint32_t down) {
    if (scan >= 256) return;
    machine_acquire();
    uint32_t previous=di_keys[scan]!=0;di_key(scan, down);win_input_key(scan,down,previous);
    machine_release();
}
void web_input_mouse(int32_t dx, int32_t dy, int32_t dz, uint32_t buttons) {
    machine_acquire();
    const int32_t movement[] = {dx, dy, dz};
    for (unsigned axis = 0; axis < 3; axis++) di_mouse[axis] += movement[axis];
    for (unsigned i = 0; i < 16; i++) if (di_devices[i].references && di_devices[i].kind == 2) {
        for (unsigned axis = 0; axis < 3; axis++) if (movement[axis]) di_enqueue(&di_devices[i], axis * 4, (uint32_t)movement[axis]);
        for (unsigned button = 0; button < 4; button++) if ((di_buttons ^ buttons) & (1u << button)) di_enqueue(&di_devices[i], 12 + button, buttons & (1u << button) ? 0x80 : 0);
    }
    win_input_mouse(dz,di_buttons,buttons);di_buttons = buttons; machine_release();
}
void web_input_focus(uint32_t focused) {
    machine_acquire(); if(di_focused!=(focused!=0))win_input_focus(focused!=0);di_focused = focused != 0;
    if (!focused) {
        for (unsigned i = 0; i < 256; i++) if (di_keys[i]) di_key(i, 0);
        for (unsigned i = 0; i < 16; i++) if (di_devices[i].references && di_devices[i].kind == 2)
            for (unsigned button = 0; button < 4; button++) if (di_buttons & (1u << button)) di_enqueue(&di_devices[i], 12 + button, 0);
        di_buttons = 0;
        for (unsigned i = 0; i < 16; i++) if (di_devices[i].references && (di_devices[i].cooperative & 4)) { di_devices[i].acquired = 0; di_devices[i].lost = 1; }
    }
    machine_release();
}
void web_input_cursor(int32_t x, int32_t y) {
    machine_acquire();win_input_cursor(x,y);machine_release();
}
uint32_t *web_input_stats(void) {
    static uint32_t stats[4];
    machine_acquire(); memset(stats, 0, sizeof stats);
    for (unsigned i = 0; i < 16; i++) if (di_devices[i].references) { stats[di_devices[i].kind]++; if (di_devices[i].acquired) stats[3]++; }
    machine_release(); return stats;
}
void web_shutdown(void) { stop_guest_workers(); }
void *web_gpu_transport(void) { return &gpu_transport; }
void web_gpu_attach(void) { atomic_store(&gpu_transport.failed,0); atomic_store(&gpu_transport.attached,1); }
void web_gpu_fail(const char *message) {
    snprintf(gpu_error,sizeof gpu_error,"%s",message); atomic_store(&gpu_transport.failed,1);gpu_wake_waiters();
}
uint32_t *web_gpu_stats(void) {
    static uint32_t stats[7]; machine_acquire();
    stats[0]=thrash_calls;stats[1]=draws;stats[2]=uploads;stats[3]=frames+software_frames;
    stats[4]=atomic_load(&gpu_transport.write)-atomic_load(&gpu_transport.read);
    stats[5]=gpu_packets;stats[6]=gpu_notifications;
    machine_release(); return stats;
}
/* Read-only driver metadata for native visual comparisons. Header words:
 * version, count, flags, raw spatial/mip filters, override, row words, reserved.
 * Rows: opaque guest handle, GPU id, width, height, format, extra mip count,
 * palette format, auxiliary flags. Framebuffer-copy textures are not included. */
uint32_t *web_thrash_textures(void) {
    static uint32_t snapshot[8+MAX_TEXTURES*8];machine_acquire();
    uint32_t count=0;
    for(unsigned i=0;i<MAX_TEXTURES;i++)if(textures[i].va){
        const texture_slot *t=textures+i;uint32_t *row=snapshot+8+count++*8;
        row[0]=t->va;row[1]=t->gpu_id;row[2]=t->width;row[3]=t->height;
        row[4]=t->format;row[5]=t->mip_levels-1;row[6]=MEM32(t->va+12);row[7]=MEM32(t->va+16)>>16;
    }
    snapshot[0]=1;snapshot[1]=count;snapshot[2]=descriptor?MEM32(descriptor+12):0;
    snapshot[3]=state_values[0][7];snapshot[4]=state_values[0][11];snapshot[5]=thrash_texture_filter;snapshot[6]=8;snapshot[7]=0;
    machine_release();return snapshot;
}
uint32_t web_registry_restore(void) { machine_acquire(); int ok = reg_restore(); machine_release(); return ok; }
void web_display_size(uint32_t width, uint32_t height, uint32_t live) {
    if (!width || !height || width > 16384 || height > 16384) return;
    machine_acquire(); win_viewport_width=width;win_viewport_height=height;
    resize_viewport=live!=0;
    if(!live||!opened){win_windows[0].width=width;win_windows[0].height=height;}
    machine_release();
}
uint32_t web_audio_mix(float *output, uint32_t frames, uint32_t rate) {
    if (!frames || frames > 4096 || rate < 8000 || rate > 192000) return 0;
    machine_acquire(); ds_mix(output, frames, rate); machine_release(); return frames;
}
uint32_t *web_audio_stats(void) {
    static uint32_t stats[4+64*10]; machine_acquire(); memset(stats, 0, sizeof stats);
    for (unsigned i = 0; i < 8; i++) stats[0] += ds_devices[i].references != 0;
    for (unsigned i = 0; i < 64; i++) if (ds_buffers[i].references) {
        ds_buffer *b=ds_buffers+i;uint32_t values[]={b->address,b->flags,ds_data[b->samples-1].bytes,b->rate,b->channels,b->bits,b->playing,b->looping,ds_play_cursor(b),ds_write_cursor(b)};
        memcpy(stats+4+stats[1]*10,values,sizeof values);stats[1]++;stats[2]+=b->playing!=0;
    }
    stats[3] = ds_mixed_frames; machine_release(); return stats;
}
uint32_t web_fs_mount(const char *source, const char *url, uint32_t size, uint32_t attributes, uint32_t modified) {
    char path[PATH_CAPACITY];
    machine_acquire();
    if (!path_full(source, path) || (url && strlen(url) >= PATH_CAPACITY)) { machine_release(); return 0; }
    fs_strip(path);
    fs_node *node = fs_find(path);
    if (!node && (!fs_parent(path) || !(node = fs_new(path, attributes)))) { machine_release(); return 0; }
    fs_uncache(node);
    fs_written -= node->capacity; free(node->data); node->data = NULL; node->capacity = 0;
    if(node->asset_data)fs_preload_bytes-=node->size;node->asset_data=NULL;
    node->attributes = attributes; node->size = size; node->modified = fs_filetime(modified); node->dirty = 0;
    if (url) strcpy(node->url, url);
    uint32_t id = (uint32_t)(node - fs_nodes) + 1;
    machine_release(); return id;
}
uint32_t web_fs_store(uint32_t id, const uint8_t *data, uint32_t size) {
    machine_acquire();
    if (!id || id > fs_count || !fs_nodes[id - 1].live || (fs_nodes[id - 1].attributes & 16)) { machine_release(); return 0; }
    fs_node *node = &fs_nodes[id - 1];
    if (!fs_resize(node, size, 0)) { machine_release(); return 0; }
    if (size) memcpy(node->data, data, size);
    machine_release(); return 1;
}
void web_fs_restore_metadata(uint32_t id, uint32_t low, uint32_t high) {
    machine_acquire();
    if (id && id <= fs_count) { fs_nodes[id - 1].modified = (uint64_t)high << 32 | low; fs_nodes[id - 1].dirty = 0; }
    machine_release();
}
uint32_t *web_fs_stats(void) {
    static uint32_t stats[4];
    machine_acquire(); stats[0] = fs_count; stats[1] = fs_reads; stats[2] = fs_fetches; stats[3] = fs_written;
    machine_release(); return stats;
}
uint32_t web_fs_preload(uint32_t id,const uint8_t *data,uint32_t size) {
    machine_acquire();
    if(!id||id>fs_count||!fs_nodes[id-1].live||(fs_nodes[id-1].attributes&16)){machine_release();return 0;}
    fs_node *node=&fs_nodes[id-1];
    if(data&&(size!=node->size||!node->url[0]||node->data)){machine_release();return 0;}
    if(node->asset_data)fs_preload_bytes-=node->size;
    node->asset_data=data;if(data)fs_preload_bytes+=size;
    machine_release();return 1;
}
uint32_t web_fs_preload_range(uint32_t id,uint32_t offset,const uint8_t *bytes,uint32_t size) {
    machine_acquire();
    if(!id||id>fs_count||!fs_nodes[id-1].live||(fs_nodes[id-1].attributes&16)){machine_release();return 0;}
    fs_node *node=fs_nodes+id-1;
    if(bytes&&(!size||offset>node->size||size>node->size-offset||node->data||!node->url[0])){machine_release();return 0;}
    unsigned slot=128;
    for(unsigned i=0;i<128;i++)if(fs_ranges[i].node==id&&fs_ranges[i].offset==offset){slot=i;break;}
    if(slot==128&&bytes)for(unsigned i=0;i<128;i++)if(!fs_ranges[i].node){slot=i;break;}
    if(slot==128){machine_release();return !bytes;}
    if(fs_ranges[slot].node)fs_preload_bytes-=fs_ranges[slot].size;
    fs_ranges[slot].node=bytes?id:0;fs_ranges[slot].offset=offset;fs_ranges[slot].size=bytes?size:0;fs_ranges[slot].bytes=bytes;
    if(bytes)fs_preload_bytes+=size;
    machine_release();return 1;
}
double *web_fs_io_stats(void) {
    static double stats[6];machine_acquire();
    stats[0]=fs_fetches;stats[1]=fs_fetch_bytes;stats[2]=fs_fetch_ms;stats[3]=fs_fetch_max_ms;stats[4]=fs_preload_reads;stats[5]=fs_preload_bytes;
    machine_release();return stats;
}
double *web_fs_io_events(void) {
    static double events[2+32*7];machine_acquire();
    uint32_t count=fs_event_count<32?fs_event_count:32;
    events[0]=fs_event_count;events[1]=count;
    for(uint32_t i=0;i<count;i++)memcpy(events+2+i*7,fs_events[(fs_event_count-count+i)%32],7*sizeof(double));
    machine_release();return events;
}
uint32_t web_fs_stream(uint32_t id) {
    machine_acquire();
    if(!id){atomic_store(&fs_stream.attached,0);atomic_fetch_add(&fs_stream.epoch,1);emscripten_futex_wake(&fs_stream.epoch,1);machine_release();return 0;}
    if(id>fs_count||!fs_nodes[id-1].live||(fs_nodes[id-1].attributes&16)||!fs_nodes[id-1].url[0]||fs_nodes[id-1].data||atomic_load(&fs_stream.attached)){machine_release();return 0;}
    memset(&fs_stream,0,sizeof fs_stream);fs_stream.node=id;fs_stream.size=fs_nodes[id-1].size;
    fs_stream.version=2;fs_stream.chunk=FS_CHUNK;fs_stream.pages=48;atomic_store(&fs_stream.start,UINT32_MAX);
    atomic_store(&fs_stream.attached,1);machine_release();return (uint32_t)(uintptr_t)&fs_stream;
}
uint32_t *web_fs_snapshot(void) {
    machine_acquire();
    if(!mapping_flush_all()){machine_release();return NULL;}
    uint32_t length = 12, count = 0;
    for (unsigned i = 0; i < fs_count; i++) if (fs_nodes[i].dirty) {
        fs_node *node = &fs_nodes[i];
        length += 28 + (((uint32_t)strlen(node->path) + 1 + 3) & ~3u);
        if (node->live && node->data) length += (node->size + 3) & ~3u;
        count++;
    }
    free(fs_snapshot_buffer); fs_snapshot_buffer = malloc(length);
    if (!fs_snapshot_buffer) { machine_release(); return NULL; }
    uint32_t *header = fs_snapshot_buffer;
    header[0] = length; header[1] = fs_revision; header[2] = count;
    uint8_t *cursor = (uint8_t *)(header + 3);
    for (unsigned i = 0; i < fs_count; i++) if (fs_nodes[i].dirty) {
        fs_node *node = &fs_nodes[i]; uint32_t path_size = (uint32_t)strlen(node->path) + 1;
        uint32_t *record = (uint32_t *)cursor;
        record[0] = node->live; record[1] = node->attributes; record[2] = node->size;
        record[3] = (uint32_t)node->modified; record[4] = (uint32_t)(node->modified >> 32);
        record[5] = path_size; record[6] = node->live && node->data ? node->size : 0xFFFFFFFF;
        cursor += 28; memcpy(cursor, node->path, path_size); cursor += (path_size + 3) & ~3u;
        if (record[6] != 0xFFFFFFFF) { memcpy(cursor, node->data, node->size); cursor += (node->size + 3) & ~3u; }
    }
    machine_release(); return fs_snapshot_buffer;
}
void web_fs_acknowledge(uint32_t revision) {
    machine_acquire();
    for (unsigned i = 0; i < fs_count; i++) if (fs_nodes[i].dirty && fs_nodes[i].dirty <= revision) fs_nodes[i].dirty = 0;
    machine_release();
}
uint32_t web_fs_remove(const char *source) {
    char path[PATH_CAPACITY]; machine_acquire();
    if (!path_full(source, path)) { machine_release(); return 0; }
    fs_strip(path); fs_node *node = fs_find(path);
    if (node) {
        node->live = 0; fs_touch(node); fs_written -= node->capacity;
        free(node->data); node->data = NULL; node->capacity = 0; fs_uncache(node);
    }
    machine_release(); return 1;
}
uint32_t *web_timer_stats(void) {
    static uint32_t stats[5];
    machine_acquire();
    stats[0] = timer_created; stats[1] = timer_fired; stats[2] = timer_callbacks; stats[3] = timer_killed;
    stats[4] = 0; for (unsigned i = 0; i < 64; i++) if (timers[i].armed) stats[4]++;
    machine_release();
    return stats;
}
