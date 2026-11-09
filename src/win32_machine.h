/* Save the global lifted register file whenever another native worker runs. */
#ifndef NFS5_WIN32_MACHINE_H
#define NFS5_WIN32_MACHINE_H
#include <pthread.h>
#include <unistd.h>
#include <stdatomic.h>

typedef struct {
    uint32_t r[8], flags[4], fs, gs, es, mxcsr, function, backedges, import[10];
    double st[8];
    int fp_top;
    uint16_t cw, segments[6];
    uint64_t mm[8];
    xmm_t xmm[8];
} guest_cpu;

typedef struct guest_thread {
    uint32_t used, id, entry, parameter, suspend, done, exit_code, object;
    int32_t priority;
    int started, joined;
    pthread_t native;
} guest_thread;

static guest_thread guest_threads[8];
static uint32_t next_thread_id = 2;
static __thread unsigned current_thread;
static __thread guest_cpu cpu;
static __thread int machine_held;
static pthread_mutex_t machine_mutex = PTHREAD_MUTEX_INITIALIZER;
static _Atomic unsigned machine_waiters;
static int cancel_workers, fatal_pending;
static _Atomic uint32_t stop_requested;
static uint32_t error_import[10], error_thread;
static void stop_guest_workers(void);
static uint32_t create_guest_thread(uint32_t entry, uint32_t parameter, uint32_t flags, uint32_t id_output, uint32_t stack_size);
static int threads_import(const char *name);
static void timer_dispatch(void);
static void wake_timers(void);

static uint32_t guest_tid(void) { return guest_threads[current_thread].id; }

static void cpu_save(void) {
    uint32_t r[] = {g_eax, g_ecx, g_edx, g_ebx, g_esp, g_ebp, g_esi, g_edi};
    uint32_t flags[] = {g_flag_k, g_flag_a, g_flag_b, g_flag_cf};
    uint16_t segments[] = {g_seg_cs, g_seg_ds, g_seg_es, g_seg_fs, g_seg_gs, g_seg_ss};
    memcpy(cpu.r, r, sizeof r); memcpy(cpu.flags, flags, sizeof flags);
    memcpy(cpu.segments, segments, sizeof segments);
    memcpy(cpu.st, g_st, sizeof g_st); memcpy(cpu.mm, g_mm, sizeof g_mm); memcpy(cpu.xmm, g_xmm, sizeof g_xmm);
    memcpy(cpu.import, import_info, sizeof import_info);
    cpu.fp_top = g_fp_top; cpu.cw = g_fpu_cw; cpu.mxcsr = g_mxcsr;
    cpu.fs = g_fs_base; cpu.gs = g_gs_base; cpu.es = g_es_base;
    cpu.function = g_cur_func; cpu.backedges = g_backedges;
}

static void cpu_load(void) {
    g_eax = cpu.r[0]; g_ecx = cpu.r[1]; g_edx = cpu.r[2]; g_ebx = cpu.r[3];
    g_esp = cpu.r[4]; g_ebp = cpu.r[5]; g_esi = cpu.r[6]; g_edi = cpu.r[7];
    g_flag_k = cpu.flags[0]; g_flag_a = cpu.flags[1]; g_flag_b = cpu.flags[2]; g_flag_cf = cpu.flags[3];
    g_seg_cs = cpu.segments[0]; g_seg_ds = cpu.segments[1]; g_seg_es = cpu.segments[2];
    g_seg_fs = cpu.segments[3]; g_seg_gs = cpu.segments[4]; g_seg_ss = cpu.segments[5];
    memcpy(g_st, cpu.st, sizeof g_st); memcpy(g_mm, cpu.mm, sizeof g_mm); memcpy(g_xmm, cpu.xmm, sizeof g_xmm);
    memcpy(import_info, cpu.import, sizeof import_info);
    g_fp_top = cpu.fp_top; g_fpu_cw = cpu.cw; g_mxcsr = cpu.mxcsr;
    g_fs_base = cpu.fs; g_gs_base = cpu.gs; g_es_base = cpu.es;
    g_cur_func = cpu.function; g_backedges = cpu.backedges;
}

static void machine_abort_check(void) {
    if (current_thread && cancel_workers) longjmp(stop, 2);
    if (fatal_pending) longjmp(stop, 1);
    if (atomic_load(&stop_requested))fail(g_cur_func,"Stopped by user");
}

static void machine_lock(void) {
    /* Shutdown needs ownership without loading a guest CPU. Count it too:
     * compute-only workers otherwise see no waiter and never yield the VM. */
    atomic_fetch_add(&machine_waiters, 1);
    pthread_mutex_lock(&machine_mutex);
    atomic_fetch_sub(&machine_waiters, 1);
}

static void machine_unlock(void) {
    pthread_mutex_unlock(&machine_mutex);
}

static void machine_acquire(void) {
    machine_lock();
    cpu_load(); machine_held = 1;
}

static void machine_release(void) {
    cpu_save(); machine_held = 0;
    machine_unlock();
}

static void machine_pause(unsigned microseconds) {
    machine_release();
    usleep(microseconds ? microseconds : 50);
    machine_acquire(); machine_abort_check();
}

static void machine_yield(void) {
    machine_abort_check();
    if (atomic_load(&machine_waiters)) machine_pause(50);
}
#endif
