/* Each native pthread keeps its C call stack; the lifted register file is
 * transferred under the machine lock at waits, sleeps and loop backedges. */
#ifndef NFS5_WIN32_THREADS_H
#define NFS5_WIN32_THREADS_H

static struct { uint32_t address, owner, recursion; } critical_sections[512];

static int critical_import(const char *name) {
    int initialize = !strcmp(name, "InitializeCriticalSection");
    int enter = !strcmp(name, "EnterCriticalSection"), leave = !strcmp(name, "LeaveCriticalSection");
    int destroy = !strcmp(name, "DeleteCriticalSection");
    if (!initialize && !enter && !leave && !destroy) return 0;
    uint32_t address = argument(0), slot = 512;
    for (unsigned i = 0; i < 512; i++) if (critical_sections[i].address == address) { slot = i; break; }
    if (initialize) {
        if (slot == 512) for (unsigned i = 0; i < 512; i++) if (!critical_sections[i].address) { slot = i; break; }
        if (slot == 512) fail(g_cur_func, "Critical-section table exhausted");
        critical_sections[slot].address = address;
        critical_sections[slot].owner = critical_sections[slot].recursion = 0;
        memset((void *)ADDR(address), 0, 24); MEM32(address + 4) = 0xFFFFFFFF;
    } else {
        if (slot == 512) fail(g_cur_func, "Uninitialized critical section at %08X", address);
        if (enter) {
            while (critical_sections[slot].owner && critical_sections[slot].owner != guest_tid()) machine_pause(1000);
            critical_sections[slot].owner = guest_tid(); critical_sections[slot].recursion++;
        } else if (leave) {
            if (critical_sections[slot].owner != guest_tid()) fail(g_cur_func, "Critical-section release by a non-owner");
            if (!--critical_sections[slot].recursion) critical_sections[slot].owner = 0;
        } else {
            if (critical_sections[slot].recursion) fail(g_cur_func, "Deleting an owned critical section");
            critical_sections[slot].address = 0;
        }
        MEM32(address + 4) = critical_sections[slot].recursion - 1;
        MEM32(address + 8) = critical_sections[slot].recursion;
        MEM32(address + 12) = critical_sections[slot].owner;
    }
    result(0, 1); return 1;
}

static void *guest_thread_main(void *opaque) {
    guest_thread *thread = opaque;
    current_thread = (unsigned)(thread - guest_threads);
    memset(&cpu, 0, sizeof cpu);
    cpu.r[4] = GUEST_SIZE - current_thread * 0x400000 - 16;
    cpu.fs = 0x10000 + current_thread * 0x2000;
    cpu.cw = 0x37F; cpu.mxcsr = 0x1F80; cpu.import[0] = 0xFFFFFFFF;
    last_error = 0;
    int stopped = setjmp(stop);
    if (!stopped) {
        machine_acquire(); machine_abort_check();
        memset((void *)ADDR(g_fs_base), 0, 0x2000);
        MEM32(g_fs_base) = 0xFFFFFFFF; MEM32(g_fs_base + 4) = g_esp;
        MEM32(g_fs_base + 8) = g_esp - 0x400000 + 16;
        MEM32(g_fs_base + 0x18) = g_fs_base; MEM32(g_fs_base + 0x24) = thread->id;
        MEM32(g_fs_base + 0x30) = 0xA000;
        while (thread->suspend) machine_pause(1000);
        recomp_func_t fn = recomp_lookup(thread->entry);
        if (!fn) fn = recomp_lookup_manual(thread->entry);
        if (!fn) fn = web_import_lookup(thread->entry);
        if (!fn) fail(thread->entry, "Guest worker entry %08X was not translated", thread->entry);
        g_esp -= 4; MEM32(g_esp) = thread->parameter;
        g_esp -= 4; MEM32(g_esp) = RECOMP_RETADDR;
        fn(); thread->exit_code = g_eax;
    }
    thread->done = 1;
    sync_clear_waiters(thread->id);
    sync_complete_waiters(&sync_objects[thread->object], 0);
    sync_objects[thread->object].references--; /* the running native thread's reference */
    machine_release();
    return NULL;
}

static void reap_guest_threads(void) {
    for (unsigned i = 1; i < 8; i++) {
        guest_thread *thread = &guest_threads[i];
        if (thread->started && thread->done && !thread->joined) {
            machine_release(); pthread_join(thread->native, NULL); machine_acquire();
            thread->joined = 1;
        }
        if (thread->joined && (!sync_objects[thread->object].references || sync_objects[thread->object].thread != thread))
            thread->used = 0;
    }
}

static uint32_t create_guest_thread(uint32_t entry, uint32_t parameter, uint32_t flags, uint32_t id_output, uint32_t stack_size) {
    if (flags & ~4u) fail(g_cur_func, "CreateThread flags %08X need implementation", flags);
    if (stack_size > 0x400000) fail(g_cur_func, "Guest worker stack larger than 4 MiB needs mapping");
    reap_guest_threads();
    for (unsigned i = 1; i < 8; i++) if (!guest_threads[i].used) {
        uint32_t handle = sync_create(SYNC_THREAD, 0, 0, 0, 0, 0);
        if (!handle) return 0;
        sync_object *object = sync_get(handle);
        guest_thread *thread = &guest_threads[i];
        memset(thread, 0, sizeof *thread);
        thread->used = 1; thread->id = next_thread_id++; thread->entry = entry; thread->parameter = parameter;
        thread->suspend = (flags & 4) != 0; thread->object = (uint32_t)(object - sync_objects);
        object->thread = thread; object->references++;
        if (pthread_create(&thread->native, NULL, guest_thread_main, thread)) {
            object->references = 0; sync_handles[(handle & 0xFFF) / 4].object = 0;
            thread->used = 0; last_error = 8; return 0;
        }
        thread->started = 1;
        if (id_output) MEM32(id_output) = thread->id;
        return handle;
    }
    last_error = 8; return 0;
}

static void stop_guest_workers(void) {
    machine_lock(); cancel_workers = 1; wake_timers(); machine_unlock();
    for (unsigned i = 1; i < 8; i++) {
        guest_thread *thread = &guest_threads[i];
        if (thread->started && !thread->joined) {
            pthread_join(thread->native, NULL); thread->joined = 1;
        }
    }
}

static int threads_import(const char *name) {
    if (critical_import(name)) return 1;
    if (!strcmp(name, "InterlockedIncrement") || !strcmp(name, "InterlockedDecrement")) {
        uint32_t address = argument(0), value = MEM32(address);
        value += !strcmp(name, "InterlockedIncrement") ? 1u : 0xFFFFFFFFu;
        MEM32(address) = value; result(value, 1); return 1;
    }
    if (!strcmp(name, "CreateThread")) {
        result(create_guest_thread(argument(2), argument(3), argument(4), argument(5), argument(1)), 6); return 1;
    }
    if (!strcmp(name, "ResumeThread")) {
        sync_object *object = sync_get(argument(0));
        if (!object || object->kind != SYNC_THREAD || !object->thread) { last_error = 6; result(0xFFFFFFFF, 1); return 1; }
        guest_thread *thread = object->thread;
        uint32_t previous = thread->suspend;
        if (previous) thread->suspend--;
        result(previous, 1); return 1;
    }
    if (!strcmp(name, "ExitThread")) {
        if (!current_thread) fail(g_cur_func, "Primary-thread ExitThread needs process shutdown");
        guest_threads[current_thread].exit_code = argument(0);
        longjmp(stop, 3);
    }
    if (!strcmp(name, "Sleep") || !strcmp(name, "SleepEx")) {
        uint32_t delay = argument(0);
        double start = emscripten_get_now();
        do { machine_pause(delay ? 1000 : 50); }
        while (delay == 0xFFFFFFFF || emscripten_get_now() - start < delay);
        result(0, !strcmp(name, "SleepEx") ? 2 : 1); return 1;
    }
    return 0;
}
#endif
