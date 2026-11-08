/* Browser host for the original program's statically translated functions. */
#include "web_runtime.h"
#include <emscripten.h>
#include <stdarg.h>
#include <time.h>

#define GUEST_SIZE (64u * 1024u * 1024u)
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

static jmp_buf stop;
static char error[512];
static uint32_t last_pc, calls, heap_next, last_error, next_tls;
static double deadline;
static uint32_t registers[8];

static void fail(uint32_t pc, const char *format, ...) {
    last_pc = pc;
    va_list ap;
    va_start(ap, format);
    vsnprintf(error, sizeof error, format, ap);
    va_end(ap);
    longjmp(stop, 1);
}

void web_unsupported(uint32_t pc, const char *instruction) {
    fail(pc, "Unsupported instruction at %08X: %s", pc, instruction);
}

void recomp_trace_enter(uint32_t va) {
    g_enter_trace[g_enter_idx++ & (TRACE_SIZE - 1)] = va;
    if (++calls > 2000000 || emscripten_get_now() > deadline)
        fail(va, "Execution budget reached at %08X", va);
}

static void check_loop(void) {
    if (emscripten_get_now() > deadline)
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

recomp_func_t recomp_lookup_manual(uint32_t va) { (void)va; return NULL; }
recomp_func_t recomp_lookup_import(uint32_t va) {
    recomp_func_t fn = web_import_lookup(va);
    if (!fn) fail(g_cur_func, "Untranslated call to %08X from %08X", va, g_cur_func);
    return fn;
}

static uint32_t argument(unsigned i) { return MEM32(g_esp + 4 + i * 4); }
static void result(uint32_t value, unsigned argc) { g_eax = value; g_esp += 4 + argc * 4; }
static uint32_t allocate(uint32_t size) {
    if (size > 0x2000000 || heap_next > 0x3000000 - size)
        fail(g_cur_func, "Guest heap exhausted (%u bytes)", size);
    uint32_t address = heap_next;
    heap_next = (heap_next + size + 15) & ~15u;
    memset((void *)ADDR(address), 0, size);
    return address;
}

void web_import(uint32_t index) {
    const char *full = web_import_names[index];
    const char *name = strchr(full, '!') + 1;
    if (!strncmp(full, "NFS5.dll!", 9))
        fail(g_cur_func, "Unimplemented Windows import: %s (caller %08X)", full, g_cur_func);
    if (!strcmp(name, "GetVersion")) { result(0x80000104u, 0); return; }
    if (!strcmp(name, "GetLastError")) { result(last_error, 0); return; }
    if (!strcmp(name, "SetLastError")) { last_error = argument(0); result(0, 1); return; }
    if (!strcmp(name, "GetModuleHandleA")) { result(0x400000, 1); return; }
    if (!strcmp(name, "GetCurrentProcess")) { result(0xFFFFFFFF, 0); return; }
    if (!strcmp(name, "GetCurrentProcessId") || !strcmp(name, "GetCurrentThreadId")) { result(1, 0); return; }
    if (!strcmp(name, "GetTickCount") || !strcmp(name, "timeGetTime")) { result((uint32_t)emscripten_get_now(), 0); return; }
    if (!strcmp(name, "QueryPerformanceFrequency")) { MEM64(argument(0)) = 1000000; result(1, 1); return; }
    if (!strcmp(name, "QueryPerformanceCounter")) { MEM64(argument(0)) = (uint64_t)(emscripten_get_now() * 1000); result(1, 1); return; }
    if (!strcmp(name, "GetProcessHeap")) { result(1, 0); return; }
    if (!strcmp(name, "HeapCreate")) { result(1, 3); return; }
    if (!strcmp(name, "HeapAlloc")) { result(allocate(argument(2)), 3); return; }
    if (!strcmp(name, "VirtualAlloc")) {
        uint32_t address = argument(0), size = argument(1);
        if (address) {
            address &= ~0xFFFu;
            if (address < 0x1000000 || address > heap_next || size > heap_next - address)
                fail(g_cur_func, "VirtualAlloc commit outside reservation: %08X + %X", address, size);
            result(address, 4); return;
        }
        heap_next = (heap_next + 0xFFFFu) & ~0xFFFFu;
        result(allocate((size + 0xFFFFu) & ~0xFFFFu), 4); return;
    }
    if (!strcmp(name, "InitializeCriticalSection") || !strcmp(name, "EnterCriticalSection") ||
        !strcmp(name, "LeaveCriticalSection") || !strcmp(name, "DeleteCriticalSection")) { result(0, 1); return; }
    if (!strcmp(name, "TlsAlloc")) {
        if (next_tls == 256) { last_error = 8; result(0xFFFFFFFF, 0); return; }
        result(next_tls++, 0); return;
    }
    if (!strcmp(name, "TlsSetValue")) {
        if (argument(0) >= next_tls) { last_error = 87; result(0, 2); return; }
        MEM32(0x9000 + argument(0) * 4) = argument(1); result(1, 2); return;
    }
    if (!strcmp(name, "TlsGetValue")) {
        if (argument(0) >= next_tls) { last_error = 87; result(0, 1); return; }
        last_error = 0; result(MEM32(0x9000 + argument(0) * 4), 1); return;
    }
    if (!strcmp(name, "GetStartupInfoA")) {
        uint32_t info = argument(0);
        memset((void *)ADDR(info), 0, 68); MEM32(info) = 68;
        result(0, 1); return;
    }
    if (!strcmp(name, "GetCommandLineA")) { result(0xB000, 0); return; }
    if (!strcmp(name, "GetEnvironmentStringsW") || !strcmp(name, "GetEnvironmentStrings")) { result(0xB100, 0); return; }
    if (!strcmp(name, "FreeEnvironmentStringsW") || !strcmp(name, "FreeEnvironmentStringsA")) { result(1, 1); return; }
    if (!strcmp(name, "GetStdHandle")) { result(0x100u + (0u - argument(0) - 10u), 1); return; }
    if (!strcmp(name, "GetFileType")) { result(argument(0) >= 0x100 && argument(0) <= 0x102 ? 2 : 0, 1); return; }
    if (!strcmp(name, "SetHandleCount")) { result(argument(0), 1); return; }
    if (!strcmp(name, "GetACP") || !strcmp(name, "GetOEMCP")) { result(1252, 0); return; }
    if (!strcmp(name, "GetCPInfo")) {
        if (argument(0) != 0 && argument(0) != 1252) fail(g_cur_func, "GetCPInfo codepage %u needs implementation", argument(0));
        uint32_t info = argument(1);
        memset((void *)ADDR(info), 0, 20); MEM32(info) = 1; MEM8(info + 4) = '?';
        result(1, 2); return;
    }
    if (!strcmp(name, "GetModuleFileNameA")) {
        uint32_t output = argument(1), size = argument(2);
        const char *path = "C:\\nfs5\\nfs5.exe";
        uint32_t length = (uint32_t)strlen(path);
        if (size <= length) { last_error = 122; result(0, 3); return; }
        memcpy((void *)ADDR(output), path, length + 1);
        result(length, 3); return;
    }
    if (!strcmp(name, "WideCharToMultiByte")) {
        uint32_t codepage = argument(0), input = argument(2), output = argument(4), capacity = argument(5);
        int32_t length = (int32_t)argument(3);
        if (codepage != 0 && codepage != 1252 && codepage != 65001)
            fail(g_cur_func, "WideCharToMultiByte codepage %u needs implementation", codepage);
        if (length == -1) { length = 0; while (MEM16(input + length * 2)) length++; length++; }
        if (length < 0) { last_error = 87; result(0, 8); return; }
        if (output && capacity < (uint32_t)length) { last_error = 122; result(0, 8); return; }
        for (int32_t i = 0; i < length; i++) {
            uint16_t value = MEM16(input + i * 2);
            if (value > 127) fail(g_cur_func, "Non-ASCII text conversion needs implementation");
            if (output) MEM8(output + i) = (uint8_t)value;
        }
        if (argument(7)) MEM32(argument(7)) = 0;
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
    if (!g_mem_base) g_mem_base = (ptrdiff_t)calloc(1, GUEST_SIZE);
    else memset((void *)g_mem_base, 0, GUEST_SIZE);
    if (!g_mem_base) return 0;
    g_eax = g_ecx = g_edx = g_ebx = g_esi = g_edi = g_ebp = 0;
    g_esp = STACK_TOP;
    g_fs_base = 0x8000;
    MEM32(g_fs_base) = 0xFFFFFFFF;
    MEM32(g_fs_base + 4) = STACK_TOP;
    MEM32(g_fs_base + 8) = STACK_TOP - 0x400000;
    MEM32(g_fs_base + 0x18) = g_fs_base;
    MEM32(g_fs_base + 0x30) = 0xA000;
    memcpy((void *)ADDR(0xB000), "C:\\nfs5\\nfs5.exe", 17);
    heap_next = 0x1000000;
    g_enter_idx = calls = g_icall_count = g_icall_trace_idx = 0;
    next_tls = last_error = g_backedges = g_cur_func = 0;
    g_flag_k = g_flag_a = g_flag_b = g_flag_cf = 0;
    memset(g_st, 0, sizeof g_st);
    g_fp_top = 0; g_fpu_cw = 0x37F;
    error[0] = 0; last_pc = 0;
    recomp_yield_hook = check_loop;
    return (uint32_t)g_mem_base;
}

int web_run(uint32_t entry, uint32_t milliseconds) {
    error[0] = 0;
    deadline = emscripten_get_now() + milliseconds;
    if (setjmp(stop)) return 1;
    recomp_func_t fn = recomp_lookup(entry);
    if (!fn) fail(entry, "Entry %08X was not translated", entry);
    g_esp -= 4; MEM32(g_esp) = RECOMP_RETADDR;
    fn();
    return 0;
}

int web_call(uint32_t entry, uint32_t a, uint32_t b, uint32_t c, uint32_t d) {
    g_esp = STACK_TOP - 16;
    MEM32(g_esp) = a; MEM32(g_esp + 4) = b;
    MEM32(g_esp + 8) = c; MEM32(g_esp + 12) = d;
    return web_run(entry, 2000);
}

uint32_t *web_registers(void) {
    registers[0] = g_eax; registers[1] = g_ecx; registers[2] = g_edx; registers[3] = g_ebx;
    registers[4] = g_esp; registers[5] = g_ebp; registers[6] = g_esi; registers[7] = g_edi;
    return registers;
}
uint32_t *web_trace(void) { return g_enter_trace; }
uint32_t web_trace_count(void) { return g_enter_idx; }
const char *web_error(void) { return error; }
uint32_t web_last_pc(void) { return last_pc; }
uint32_t web_heap(void) { return heap_next; }
void web_set_register(uint32_t index, uint32_t value) {
    uint32_t *r[] = { &g_eax, &g_ecx, &g_edx, &g_ebx, &g_esp, &g_ebp, &g_esi, &g_edi };
    if (index < 8) *r[index] = value;
}
double web_float_result(void) { return g_st[0]; }
