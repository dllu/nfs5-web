/* Multimedia timers share one guest callback worker. All timer state is
 * protected by the machine lock; a futex wakes the dispatcher on changes. */
#ifndef NFS5_WIN32_TIMERS_H
#define NFS5_WIN32_TIMERS_H
#include <emscripten/threading.h>
#include <limits.h>

typedef struct {
    uint32_t id, delay, callback, user, flags, armed, firing;
    double due;
} guest_timer;
static guest_timer timers[64];
static uint32_t next_timer_id = 1, timer_worker;
static _Atomic uint32_t timer_epoch;
static uint32_t timer_created, timer_fired, timer_callbacks, timer_killed;

/* This notification also runs from Stop without entering the guest machine. */
static void notify_timer_waiters(void) {
    atomic_fetch_add(&timer_epoch, 1);
    emscripten_futex_wake((void *)&timer_epoch, INT_MAX);
}

static void wake_timers(void) {
    if (cancel_workers) for (unsigned i = 0; i < 64; i++) memset(&timers[i], 0, sizeof timers[i]);
    notify_timer_waiters();
}

static void timer_dispatch(void) {
    for (;;) {
        machine_abort_check();
        double now = emscripten_get_now(), due = INFINITY;
        guest_timer *timer = NULL;
        for (unsigned i = 0; i < 64; i++) if (timers[i].armed && timers[i].due < due) {
            timer = &timers[i]; due = timer->due;
        }
        if (!timer || due > now) {
            uint32_t epoch = atomic_load(&timer_epoch);
            machine_wait(&timer_epoch, epoch, timer ? due - now : INFINITY);
            continue;
        }
        uint32_t id = timer->id, callback = timer->callback, user = timer->user, flags = timer->flags;
        timer->firing = 1;
        if (flags & 1) timer->due += (floor((now - due) / timer->delay) + 1) * timer->delay;
        else timer->armed = 0;
        timer_fired++;
        if (flags & 0x30) {
            sync_object *event = sync_get(callback);
            if (event && event->kind == SYNC_EVENT) sync_signal_event(event, (flags & 0x20) != 0);
        } else {
            recomp_func_t fn = recomp_lookup(callback);
            if (!fn) fn = recomp_lookup_manual(callback);
            if (!fn) fn = web_import_lookup(callback);
            if (!fn) fail(callback, "Timer callback %08X was not translated", callback);
            cpu_save(); guest_cpu saved = cpu;
            uint32_t stack = g_esp;
            const uint32_t args[] = {id, 0, user, 0, 0};
            for (int i = 4; i >= 0; i--) { g_esp -= 4; MEM32(g_esp) = args[i]; }
            g_esp -= 4; MEM32(g_esp) = RECOMP_RETADDR;
            timer_callbacks++; fn();
            if (g_esp != stack) fail(callback, "Timer callback %08X left an unbalanced stack (%08X, expected %08X)", callback, g_esp, stack);
            cpu = saved; cpu_load();
        }
        timer->firing = 0;
        if (!timer->armed && timer->id == id) timer->id = 0;
    }
}

static int timer_import(const char *full) {
    if (!strcmp(full, "WINMM.dll!timeSetEvent")) {
        uint32_t delay = argument(0), callback = argument(2), flags = argument(4);
        if (!delay || delay > 1000 || !callback || (flags & ~0x131u) || (flags & 0x30) == 0x30) {
            result(0, 5); return 1;
        }
        if (flags & 0x30) {
            sync_object *event = sync_get(callback);
            if (!event || event->kind != SYNC_EVENT) { result(0, 5); return 1; }
        }
        for (unsigned i = 0; i < 64; i++) if (!timers[i].id) {
            if (!timer_worker) {
                timer_worker = create_guest_thread(0xF1000010, 0, 0, 0, 0);
                if (!timer_worker) { result(0, 5); return 1; }
            }
            guest_timer *timer = &timers[i];
            memset(timer, 0, sizeof *timer);
            timer->id = next_timer_id++;
            if (!timer->id) timer->id = next_timer_id++;
            timer->delay = delay; timer->callback = callback; timer->user = argument(3); timer->flags = flags;
            timer->due = emscripten_get_now() + delay; timer->armed = 1;
            timer_created++; wake_timers();
            result(timer->id, 5); return 1;
        }
        result(0, 5); return 1;
    }
    if (!strcmp(full, "WINMM.dll!timeKillEvent")) {
        uint32_t id = argument(0);
        for (unsigned i = 0; id && i < 64; i++) if (timers[i].id == id) {
            guest_timer *timer = &timers[i];
            timer->armed = 0; wake_timers(); timer_killed++;
            sync_object *worker = sync_get(timer_worker);
            if ((timer->flags & 0x100) && worker && worker->thread != &guest_threads[current_thread])
                while (timer->id == id && timer->firing) machine_pause(1000);
            if (timer->id == id && !timer->firing) timer->id = 0;
            result(0, 1); return 1;
        }
        result(11, 1); return 1;
    }
    return 0;
}
#endif
