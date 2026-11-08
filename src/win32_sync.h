/* Kernel synchronization for the currently serialized guest CPU.
 * A blocking wait needs the guest scheduler; never fabricate a successful wait. */
#ifndef NFS5_WIN32_SYNC_H
#define NFS5_WIN32_SYNC_H

enum { SYNC_MUTEX = 1, SYNC_EVENT, SYNC_SEMAPHORE, SYNC_THREAD };
typedef struct {
    uint32_t kind, references, owner, count, maximum, manual;
    char name[260];
} sync_object;
typedef struct { uint32_t generation, object; } sync_handle;
static sync_object sync_objects[256];
static sync_handle sync_handles[512];
static int32_t sync_thread_priority;

static sync_object *sync_get(uint32_t handle) {
    uint32_t slot = (handle & 0xFFF) / 4, generation = (handle >> 12) & 0xFFF;
    if ((handle & 0xFF000003) != 0x71000000 || slot >= 512 || !generation) return NULL;
    sync_handle *entry = &sync_handles[slot];
    if (!entry->object || entry->generation != generation) return NULL;
    return &sync_objects[entry->object - 1];
}

static uint32_t sync_reference(uint32_t object) {
    for (uint32_t i = 0; i < 512; i++) {
        sync_handle *handle = &sync_handles[i];
        if (handle->object || handle->generation == 0xFFF) continue;
        handle->object = object + 1; handle->generation++;
        sync_objects[object].references++;
        return 0x71000000 | (handle->generation << 12) | (i * 4);
    }
    last_error = 8; return 0;
}

static uint32_t sync_create(uint32_t kind, uint32_t name_va, int opening,
                            uint32_t initial, uint32_t maximum, uint32_t manual) {
    const char *name = name_va ? (const char *)ADDR(name_va) : NULL;
    if (name && !*name) name = NULL;
    if (name && strlen(name) >= sizeof sync_objects[0].name) { last_error = 206; return 0; }
    for (uint32_t i = 0; name && i < 256; i++) {
        sync_object *object = &sync_objects[i];
        if (!object->references || !object->name[0] || strcmp(object->name, name)) continue;
        if (object->kind != kind) { last_error = 6; return 0; }
        uint32_t handle = sync_reference(i);
        if (handle && !opening) last_error = 183;
        return handle;
    }
    if (opening) { last_error = 2; return 0; }
    if (kind == SYNC_SEMAPHORE && (!maximum || maximum > 0x7FFFFFFF || initial > maximum)) {
        last_error = 87; return 0;
    }
    for (uint32_t i = 0; i < 256; i++) if (!sync_objects[i].references) {
        sync_object *object = &sync_objects[i];
        memset(object, 0, sizeof *object);
        object->kind = kind; object->count = initial; object->maximum = maximum;
        object->manual = manual; object->owner = kind == SYNC_MUTEX && initial ? 1 : 0;
        if (name) strcpy(object->name, name);
        uint32_t handle = sync_reference(i);
        if (handle) last_error = 0;
        return handle;
    }
    last_error = 8; return 0;
}

static int sync_ready(sync_object *object) {
    return object->kind == SYNC_MUTEX ? !object->owner || object->owner == 1 : object->count > 0;
}

static void sync_take(sync_object *object) {
    if (object->kind == SYNC_MUTEX) { object->owner = 1; object->count++; }
    else if (object->kind == SYNC_SEMAPHORE || (object->kind == SYNC_EVENT && !object->manual)) object->count--;
}

static uint32_t sync_wait(uint32_t count, const uint32_t *handles, int all, uint32_t timeout) {
    if (!count || count > 64) { last_error = 87; return 0xFFFFFFFF; }
    sync_object *objects[64];
    for (uint32_t i = 0; i < count; i++) {
        objects[i] = sync_get(handles[i]);
        if (!objects[i]) { last_error = 6; return 0xFFFFFFFF; }
        for (uint32_t j = 0; j < i; j++) if (handles[j] == handles[i]) {
            last_error = 87; return 0xFFFFFFFF;
        }
    }
    if (all) {
        int ready = 1;
        for (uint32_t i = 0; i < count; i++) if (!sync_ready(objects[i])) ready = 0;
        if (ready) { for (uint32_t i = 0; i < count; i++) sync_take(objects[i]); return 0; }
    } else {
        for (uint32_t i = 0; i < count; i++) if (sync_ready(objects[i])) { sync_take(objects[i]); return i; }
    }
    if (!timeout) return 258;
    fail(g_cur_func, "Blocking synchronization wait needs guest scheduling (%u objects, timeout %u)", count, timeout);
    return 0xFFFFFFFF;
}

static int sync_import(const char *name) {
    if (!strcmp(name, "GetCurrentThread")) { result(0xFFFFFFFE, 0); return 1; }
    if (!strcmp(name, "GetThreadPriority") || !strcmp(name, "SetThreadPriority")) {
        sync_object *object = sync_get(argument(0));
        int setting = !strcmp(name, "SetThreadPriority");
        if (argument(0) != 0xFFFFFFFE && (!object || object->kind != SYNC_THREAD)) {
            last_error = 6; result(setting ? 0 : 0x7FFFFFFF, setting ? 2 : 1); return 1;
        }
        if (setting) sync_thread_priority = (int32_t)argument(1);
        result(setting ? 1 : (uint32_t)sync_thread_priority, setting ? 2 : 1); return 1;
    }
    if (!strcmp(name, "DuplicateHandle")) {
        uint32_t handle = argument(1), copy = 0;
        sync_object *object = sync_get(handle);
        if (argument(0) != 0xFFFFFFFF || argument(2) != 0xFFFFFFFF || !argument(3)) {
            last_error = 6; result(0, 7); return 1;
        }
        if (handle == 0xFFFFFFFE) copy = sync_create(SYNC_THREAD, 0, 0, 0, 0, 0);
        else if (object) copy = sync_reference((uint32_t)(object - sync_objects));
        else { last_error = 6; result(0, 7); return 1; }
        if (!copy) { result(0, 7); return 1; }
        if (object && (argument(6) & 1)) {
            object->references--; sync_handles[(handle & 0xFFF) / 4].object = 0;
        }
        MEM32(argument(3)) = copy; result(1, 7); return 1;
    }
    if (!strcmp(name, "CreateMutexA")) {
        result(sync_create(SYNC_MUTEX, argument(2), 0, argument(1) != 0, 0, 0), 3); return 1;
    }
    if (!strcmp(name, "OpenMutexA") || !strcmp(name, "OpenSemaphoreA")) {
        result(sync_create(!strcmp(name, "OpenMutexA") ? SYNC_MUTEX : SYNC_SEMAPHORE,
                           argument(2), 1, 0, 0, 0), 3); return 1;
    }
    if (!strcmp(name, "CreateEventA")) {
        result(sync_create(SYNC_EVENT, argument(3), 0, argument(2) != 0, 0, argument(1) != 0), 4); return 1;
    }
    if (!strcmp(name, "CreateSemaphoreA")) {
        result(sync_create(SYNC_SEMAPHORE, argument(3), 0, argument(1), argument(2), 0), 4); return 1;
    }
    if (!strcmp(name, "CloseHandle")) {
        uint32_t handle = argument(0);
        sync_object *object = sync_get(handle);
        if (!object) { last_error = 6; result(0, 1); return 1; }
        object->references--; sync_handles[(handle & 0xFFF) / 4].object = 0;
        result(1, 1); return 1;
    }
    if (!strcmp(name, "ReleaseMutex")) {
        sync_object *object = sync_get(argument(0));
        if (!object || object->kind != SYNC_MUTEX) { last_error = 6; result(0, 1); return 1; }
        if (object->owner != 1) { last_error = 288; result(0, 1); return 1; }
        if (!--object->count) object->owner = 0;
        result(1, 1); return 1;
    }
    if (!strcmp(name, "SetEvent") || !strcmp(name, "ResetEvent") || !strcmp(name, "PulseEvent")) {
        sync_object *object = sync_get(argument(0));
        if (!object || object->kind != SYNC_EVENT) { last_error = 6; result(0, 1); return 1; }
        object->count = !strcmp(name, "SetEvent");
        result(1, 1); return 1;
    }
    if (!strcmp(name, "ReleaseSemaphore")) {
        sync_object *object = sync_get(argument(0));
        uint32_t count = argument(1);
        if (!object || object->kind != SYNC_SEMAPHORE) { last_error = 6; result(0, 3); return 1; }
        if (!count || count > 0x7FFFFFFF) { last_error = 87; result(0, 3); return 1; }
        if (count > object->maximum - object->count) { last_error = 298; result(0, 3); return 1; }
        if (argument(2)) MEM32(argument(2)) = object->count;
        object->count += count; result(1, 3); return 1;
    }
    if (!strcmp(name, "WaitForSingleObject")) {
        uint32_t handle = argument(0);
        result(sync_wait(1, &handle, 0, argument(1)), 2); return 1;
    }
    if (!strcmp(name, "WaitForMultipleObjectsEx")) {
        uint32_t count = argument(0), handles[64];
        if (count > 64 || !count) { last_error = 87; result(0xFFFFFFFF, 5); return 1; }
        for (uint32_t i = 0; i < count; i++) handles[i] = MEM32(argument(1) + i * 4);
        result(sync_wait(count, handles, argument(2) != 0, argument(3)), 5); return 1;
    }
    return 0;
}
#endif
