/* DirectInput A/Device2A ABI. Descriptor layouts and GUID helpers are adapted
 * from nfspu-recomp/src/host/dinput.c (MIT, copyright 2026 Sergei Biriukov). */
#ifndef NFS5_WIN32_DINPUT_H
#define NFS5_WIN32_DINPUT_H

#define DI_INVALID 0x80070057u
#define DI_NOTACQUIRED 0x8007000Cu
#define DI_UNSUPPORTED 0x80004001u
typedef struct {
    uint32_t size, instance[4], product[4], type;
    char instance_name[260], product_name[260];
    uint32_t ff_driver[4];
    uint16_t usage_page, usage;
} di_device_instance;
typedef struct {
    uint32_t size, guid[4], offset, type, flags;
    char name[260];
    uint32_t ff_max, ff_resolution;
    uint16_t collection, designator, usage_page, usage;
    uint32_t dimension;
    uint16_t exponent, report;
} di_object_instance;
_Static_assert(sizeof(di_device_instance) == 580, "DIDEVICEINSTANCEA");
_Static_assert(sizeof(di_object_instance) == 316, "DIDEVICEOBJECTINSTANCEA");

typedef struct {
    uint32_t address, kind, references, acquired, lost, format, cooperative, notification;
    uint32_t buffer_size, buffer_requested, head, count, overflow;
    int32_t last_mouse[3];
    uint32_t events[256][4];
} di_device;
static di_device di_devices[16];
static uint32_t di_root_table, di_device_table, di_selected, di_sequence;
static uint8_t di_keys[256], di_buttons;
static uint8_t di_pressed[256], di_toggled[256];
static int32_t di_mouse[3];
static int32_t di_cursor[2];
static int di_focused = 1;

static uint32_t guest_callback(uint32_t address, unsigned count, const uint32_t *arguments) {
    recomp_func_t fn = recomp_lookup_manual(address);
    if (!fn) fn = recomp_lookup(address);
    if (!fn) fn = web_import_lookup(address);
    if (!fn) fail(address, "Callback %08X was not translated", address);
    cpu_save(); guest_cpu saved = cpu;
    uint32_t stack = g_esp;
    for (unsigned i = count; i; i--) { g_esp -= 4; MEM32(g_esp) = arguments[i - 1]; }
    g_esp -= 4; MEM32(g_esp) = RECOMP_RETADDR;
    fn();
    if (g_esp != stack) fail(address, "Callback %08X left an unbalanced stack (%08X, expected %08X)", address, g_esp, stack);
    uint32_t value = g_eax;
    cpu = saved; cpu_load();
    return value;
}

static void di_guid(uint32_t guid[4], uint32_t first, uint16_t second) {
    guid[0] = first; guid[1] = 0x11CF0000u | second;
    guid[2] = 0x4544C7BFu; guid[3] = 0x5453;
}
static int di_guid_is(uint32_t address, uint32_t first, uint16_t second) {
    return address && MEM32(address) == first && MEM32(address + 4) == (0x11CF0000u | second) &&
        MEM32(address + 8) == 0x4544C7BFu && MEM32(address + 12) == 0x5453;
}
static uint32_t di_type(unsigned kind) { return kind == 2 ? 0x202 : 0x403; }
static void di_describe_device(di_device_instance *desc, unsigned kind) {
    memset(desc, 0, sizeof *desc); desc->size = sizeof *desc;
    di_guid(desc->instance, kind == 2 ? 0x6F1D2B60 : 0x6F1D2B61, 0xD5A0);
    memcpy(desc->product, desc->instance, 16); desc->type = di_type(kind);
    snprintf(desc->instance_name, 260, "System %s", kind == 2 ? "Mouse" : "Keyboard");
    strcpy(desc->product_name, desc->instance_name);
    desc->usage_page = 1; desc->usage = kind == 2 ? 2 : 6;
}
static void di_describe_object(di_object_instance *desc, unsigned kind, unsigned index) {
    memset(desc, 0, sizeof *desc); desc->size = sizeof *desc;
    if (kind == 1) {
        di_guid(desc->guid, 0x55728220, 0xD33C);
        desc->offset = index; desc->type = 4 | index << 8;
        snprintf(desc->name, 260, "Key %02X", index); desc->usage_page = 7;
    } else if (index < 3) {
        di_guid(desc->guid, 0xA36D02E0 + index, 0xC9F3);
        desc->offset = index * 4; desc->type = 1 | index << 8; desc->flags = 0x100;
        snprintf(desc->name, 260, "%c Axis", "XYZ"[index]); desc->usage_page = 1; desc->usage = 0x30 + index;
    } else {
        di_guid(desc->guid, 0xA36D02F0, 0xC9F3);
        desc->offset = 12 + index - 3; desc->type = 4 | (index - 3) << 8;
        snprintf(desc->name, 260, "Button %u", index - 2); desc->usage_page = 9; desc->usage = index - 2;
    }
}
static di_device *di_find(uint32_t address) {
    for (unsigned i = 0; i < 16; i++) if (di_devices[i].references && di_devices[i].address == address) return &di_devices[i];
    return NULL;
}
static uint32_t di_new(unsigned kind) {
    if (!di_root_table) {
        di_root_table = allocate(9 * 4); di_device_table = allocate(27 * 4);
        for (unsigned i = 0; i < 9; i++) MEM32(di_root_table + i * 4) = 0xF2000000 + i * 4;
        for (unsigned i = 0; i < 27; i++) MEM32(di_device_table + i * 4) = 0xF2000100 + i * 4;
    }
    for (unsigned i = 0; i < 16; i++) if (!di_devices[i].references) {
        di_device *device = &di_devices[i]; memset(device, 0, sizeof *device);
        device->address = allocate(8); device->kind = kind; device->references = 1;
        MEM32(device->address) = kind ? di_device_table : di_root_table;
        MEM32(device->address + 4) = 1;
        return device->address;
    }
    return 0;
}

static void di_enqueue(di_device *device, uint32_t offset, uint32_t value) {
    if (!device->acquired) return;
    sync_object *notification = sync_get(device->notification);
    if (notification && notification->kind == SYNC_EVENT) sync_signal_event(notification, 0);
    if (!device->buffer_size) return;
    if (device->count == device->buffer_size) {
        device->head = (device->head + 1) % 256; device->count--; device->overflow = 1;
    }
    uint32_t *event = device->events[(device->head + device->count++) % 256];
    event[0] = offset; event[1] = value; event[2] = (uint32_t)emscripten_get_now(); event[3] = ++di_sequence;
}

static void di_key(uint32_t scan, uint32_t down) {
    if (scan >= 256) return;
    uint8_t value = down ? 0x80 : 0;
    if (di_keys[scan] == value) return;
    di_keys[scan] = value;
    if (down) {
        di_pressed[scan] = 1;
        if (scan == 0x3A || scan == 0x45 || scan == 0x46) di_toggled[scan] ^= 1;
    }
    for (unsigned i = 0; i < 16; i++) if (di_devices[i].references && di_devices[i].kind == 1) di_enqueue(&di_devices[i], scan, value);
}

static unsigned di_scan(uint32_t vk) {
    static const uint8_t letters[] = {0x1E,0x30,0x2E,0x20,0x12,0x21,0x22,0x23,0x17,0x24,0x25,0x26,0x32,0x31,0x18,0x19,0x10,0x13,0x1F,0x14,0x16,0x2F,0x11,0x2D,0x15,0x2C};
    if (vk >= 'A' && vk <= 'Z') return letters[vk - 'A'];
    if (vk >= '1' && vk <= '9') return vk - '1' + 2;
    if (vk >= 0x70 && vk <= 0x79) return vk - 0x70 + 0x3B;
    switch (vk) {
    case '0': return 0x0B; case 8: return 0x0E; case 9: return 0x0F; case 13: return 0x1C;
    case 16: case 0xA0: return 0x2A; case 0xA1: return 0x36;
    case 17: case 0xA2: return 0x1D; case 0xA3: return 0x9D;
    case 18: case 0xA4: return 0x38; case 0xA5: return 0xB8;
    case 19: return 0xC5; case 20: return 0x3A; case 27: return 1; case 32: return 0x39;
    case 33: return 0xC9; case 34: return 0xD1; case 35: return 0xCF; case 36: return 0xC7;
    case 37: return 0xCB; case 38: return 0xC8; case 39: return 0xCD; case 40: return 0xD0;
    case 45: return 0xD2; case 46: return 0xD3; case 0x7A: return 0x57; case 0x7B: return 0x58;
    case 0x90: return 0x45; case 0x91: return 0x46; default: return 0;
    }
}

static uint32_t di_key_state(uint32_t vk, int asynchronous) {
    unsigned scan = di_scan(vk), other = vk == 16 ? 0x36 : vk == 17 ? 0x9D : vk == 18 ? 0xB8 : vk == 13 ? 0x9C : 0;
    if (!scan) return 0;
    uint32_t down = di_keys[scan] || (other && di_keys[other]);
    uint32_t low = asynchronous ? di_pressed[scan] || (other && di_pressed[other]) : di_toggled[scan];
    if (asynchronous) { di_pressed[scan] = 0; if (other) di_pressed[other] = 0; }
    return (down ? 0x8000 : 0) | low;
}

static void di_method(void) {
    uint32_t selected = di_selected, method = (selected & 0xFF) / 4;
    machine_yield();
    di_device *device = di_find(argument(0));
    if (!device) fail(g_cur_func, "DirectInput method %u on an invalid object %08X", method, argument(0));
    int root = !(selected & 0x100);
    if (root != (device->kind == 0)) fail(g_cur_func, "DirectInput vtable/object mismatch");
    if (method == 0) {
        uint32_t iid = argument(1), out = argument(2);
        if (!out) { result(0x80004003, 3); return; }
        MEM32(out) = 0;
        int unknown = iid && !MEM32(iid) && !MEM32(iid + 4) && MEM32(iid + 8) == 0xC0 && MEM32(iid + 12) == 0x46000000;
        int supported = root ? di_guid_is(iid, 0x89521360, 0xAA8A) || di_guid_is(iid, 0x5944E662, 0xAA8A) :
            di_guid_is(iid, 0x5944E680, 0xC92E) || di_guid_is(iid, 0x5944E682, 0xC92E);
        if (!unknown && !supported) { result(0x80004002, 3); return; }
        MEM32(out) = device->address; MEM32(device->address + 4) = ++device->references;
        result(0, 3); return;
    }
    if (method == 1 || method == 2) {
        uint32_t references = method == 1 ? ++device->references : --device->references;
        MEM32(device->address + 4) = references;
        if (!references) release_block(find_block(device->address, 1));
        result(references, 1); return;
    }
    if (root) {
        if (method == 3) {
            uint32_t guid = argument(1), out = argument(2);
            if (!out) { result(DI_INVALID, 4); return; }
            MEM32(out) = 0;
            if (argument(3)) { result(0x80040110, 4); return; }
            unsigned kind = di_guid_is(guid, 0x6F1D2B61, 0xD5A0) ? 1 : di_guid_is(guid, 0x6F1D2B60, 0xD5A0) ? 2 : 0;
            if (!kind) { result(0x80040154, 4); return; }
            MEM32(out) = di_new(kind); result(MEM32(out) ? 0 : 0x8007000E, 4); return;
        }
        if (method == 4) {
            uint32_t type = argument(1), callback = argument(2), context = argument(3), flags = argument(4);
            if (!callback) { result(DI_INVALID, 5); return; }
            if (flags & 0x100) { result(0, 5); return; }
            uint32_t desc = allocate(sizeof(di_device_instance));
            for (unsigned kind = 1; kind <= 2; kind++) {
                if (type && type != (kind == 1 ? 3 : 2)) continue;
                di_describe_device((di_device_instance *)ADDR(desc), kind);
                uint32_t args[] = {desc, context};
                if (!guest_callback(callback, 2, args)) break;
            }
            release_block(find_block(desc, 1)); result(0, 5); return;
        }
        if (method == 5) { result(di_guid_is(argument(1), 0x6F1D2B61, 0xD5A0) || di_guid_is(argument(1), 0x6F1D2B60, 0xD5A0) ? 0 : 0x80040154, 2); return; }
        if (method == 6 || method == 7) { result(0, 3); return; }
        if (method == 8) { result(0x80040154, 4); return; }
    } else {
        if (method == 3) {
            uint32_t out = argument(1), size = out ? MEM32(out) : 0;
            if (size != 24 && size != 44) { result(DI_INVALID, 2); return; }
            memset((void *)ADDR(out), 0, size); MEM32(out) = size; MEM32(out + 4) = 5;
            MEM32(out + 8) = di_type(device->kind); MEM32(out + 12) = device->kind == 2 ? 3 : 0;
            MEM32(out + 16) = device->kind == 2 ? 4 : 256; result(0, 2); return;
        }
        if (method == 4) {
            uint32_t callback = argument(1), context = argument(2), filter = argument(3);
            if (!callback) { result(DI_INVALID, 4); return; }
            if (filter & 0x11000000) { result(0, 4); return; }
            uint32_t desc = allocate(sizeof(di_object_instance));
            for (unsigned i = 0; i < (device->kind == 1 ? 256u : 7u); i++) {
                di_object_instance *object = (di_object_instance *)ADDR(desc); di_describe_object(object, device->kind, i);
                if ((filter & 0xFF) && !(filter & object->type & 0xFF)) continue;
                uint32_t instance = filter & 0x00FFFF00;
                if (instance && instance != 0x00FFFF00 && instance != (object->type & 0x00FFFF00)) continue;
                uint32_t args[] = {desc, context}; if (!guest_callback(callback, 2, args)) break;
            }
            release_block(find_block(desc, 1)); result(0, 4); return;
        }
        if (method == 5 || method == 6) {
            uint32_t property = argument(1), out = argument(2);
            if (!out || MEM32(out) != 20 || MEM32(out + 4) != 16 || MEM32(out + 12)) { result(DI_INVALID, 3); return; }
            if (method == 6 && device->acquired) { result(0x800700AA, 3); return; }
            if (property == 2 && device->kind == 2) {
                if (method == 6 && MEM32(out + 16) != 1) { result(DI_UNSUPPORTED, 3); return; }
                if (method == 5) MEM32(out + 16) = 1;
                result(0, 3); return;
            }
            if (property != 1) { result(DI_UNSUPPORTED, 3); return; }
            if (method == 6) {
                device->buffer_requested = MEM32(out + 16);
                device->buffer_size = device->buffer_requested > 256 ? 256 : device->buffer_requested;
                device->head = device->count = device->overflow = 0;
            } else MEM32(out + 16) = device->buffer_requested;
            result(0, 3); return;
        }
        if (method == 7) {
            if (!device->format) { result(DI_INVALID, 1); return; }
            if ((device->cooperative & 4) && !di_focused) { result(0x80070005, 1); return; }
            int acquired = device->acquired; device->acquired = 1; device->lost = 0;
            if (!acquired) {
                memcpy(device->last_mouse, di_mouse, sizeof di_mouse);
                device->head = device->count = device->overflow = 0;
            }
            result(acquired ? 1 : 0, 1); return;
        }
        if (method == 8) { device->acquired = 0; device->head = device->count = device->overflow = 0; result(0, 1); return; }
        if (method == 9 || method == 10 || method == 25) {
            unsigned argc = method == 9 ? 3 : method == 10 ? 5 : 1;
            if (!device->acquired) { result(device->lost ? 0x8007001E : DI_NOTACQUIRED, argc); return; }
            if (method == 25) { result(0, 1); return; }
            if (method == 9) {
                uint32_t size = argument(1), out = argument(2);
                if (!out || size != device->format) { result(DI_INVALID, 3); return; }
                memset((void *)ADDR(out), 0, size);
                if (device->kind == 1) memcpy((void *)ADDR(out), di_keys, 256);
                else {
                    for (unsigned i = 0; i < 3; i++) { MEM32(out + i * 4) = di_mouse[i] - device->last_mouse[i]; device->last_mouse[i] = di_mouse[i]; }
                    for (unsigned i = 0; i < 4; i++) MEM8(out + 12 + i) = di_buttons & (1u << i) ? 0x80 : 0;
                }
                result(0, 3); return;
            }
            uint32_t stride = argument(1), out = argument(2), count = argument(3), flags = argument(4);
            if (!count || (stride != 16 && stride != 20) || (flags & ~1u)) { result(DI_INVALID, 5); return; }
            if (!device->buffer_size) { result(0x80070032, 5); return; }
            uint32_t available = device->count, requested = MEM32(count), n = requested < available ? requested : available;
            for (uint32_t i = 0; out && i < n; i++) {
                memcpy((void *)ADDR(out + i * stride), device->events[(device->head + i) % 256], 16);
                if (stride == 20) MEM32(out + i * stride + 16) = 0;
            }
            MEM32(count) = n; uint32_t overflow = device->overflow;
            if (!(flags & 1)) { device->head = (device->head + n) % 256; device->count -= n; device->overflow = 0; }
            result(overflow ? 1 : 0, 5); return;
        }
        if (method == 11) {
            uint32_t format = argument(1);
            if (device->acquired) { result(0x800700AA, 2); return; }
            if (!format || MEM32(format) != 24 || MEM32(format + 4) != 16) { result(DI_INVALID, 2); return; }
            uint32_t size = MEM32(format + 12), count = MEM32(format + 16), objects = MEM32(format + 20);
            if (size != (device->kind == 1 ? 256u : 16u) || count > (device->kind == 1 ? 256u : 7u) || (count && !objects)) { result(DI_INVALID, 2); return; }
            for (uint32_t i = 0; i < count; i++) {
                uint32_t object = objects + i * 16, offset = MEM32(object + 4), type = MEM32(object + 8), width = type & 3 ? 4 : 1;
                if (offset >= size || width > size - offset || (device->kind == 1 && (!(type & 0xC) || ((type >> 8) & 0xFFFF) != offset))) { result(DI_INVALID, 2); return; }
                if (device->kind == 2 && ((type & 3) ? offset > 8 || offset % 4 : offset < 12 || offset > 15)) { result(DI_INVALID, 2); return; }
            }
            device->format = size; result(0, 2); return;
        }
        if (method == 12) {
            uint32_t event = argument(1); sync_object *object = sync_get(event);
            if (event && (!object || object->kind != SYNC_EVENT)) { result(DI_INVALID, 2); return; }
            device->notification = event; result(0, 2); return;
        }
        if (method == 13) {
            uint32_t flags = argument(2);
            if (!(flags & 3) || (flags & 3) == 3 || !(flags & 12) || (flags & 12) == 12 || (flags & ~31u)) { result(DI_INVALID, 3); return; }
            device->cooperative = flags; result(0, 3); return;
        }
        if (method == 14) {
            uint32_t out = argument(1), object = argument(2), how = argument(3), size = out ? MEM32(out) : 0;
            if ((size != 292 && size != 316) || (how != 1 && how != 2)) { result(DI_INVALID, 4); return; }
            for (unsigned i = 0; i < (device->kind == 1 ? 256u : 7u); i++) {
                di_object_instance desc; di_describe_object(&desc, device->kind, i);
                if ((how == 1 && object == desc.offset) || (how == 2 && object == desc.type)) {
                    memcpy((void *)ADDR(out), &desc, size); MEM32(out) = size; result(0, 4); return;
                }
            }
            result(0x80070002, 4); return;
        }
        if (method == 15) {
            uint32_t out = argument(1), size = out ? MEM32(out) : 0;
            if (size != 560 && size != 580) { result(DI_INVALID, 2); return; }
            di_device_instance desc; di_describe_device(&desc, device->kind);
            memcpy((void *)ADDR(out), &desc, size); MEM32(out) = size; result(0, 2); return;
        }
        if (method == 16) { result(0, 3); return; }
        if (method == 17) { result(0, 4); return; }
        if (method == 18) { if (argument(3)) MEM32(argument(3)) = 0; result(DI_UNSUPPORTED, 5); return; }
        if (method == 19 || method == 23) { result(0, 4); return; }
        if (method == 20) { result(DI_UNSUPPORTED, 3); return; }
        if (method == 21) { if (argument(1)) MEM32(argument(1)) = 0; result(DI_UNSUPPORTED, 2); return; }
        if (method == 22 || method == 24) { result(DI_UNSUPPORTED, 2); return; }
        if (method == 26) { if (argument(3)) MEM32(argument(3)) = 0; result(DI_UNSUPPORTED, 5); return; }
    }
    fail(g_cur_func, "Unimplemented DirectInput %s method %u", root ? "root" : "device", method);
}

static recomp_func_t dinput_lookup(uint32_t address) {
    if (address >= 0xF2000000 && address < 0xF2000024 && !(address & 3)) { di_selected = address; return di_method; }
    if (address >= 0xF2000100 && address < 0xF200016C && !(address & 3)) { di_selected = address; return di_method; }
    return NULL;
}
static int dinput_import(const char *full) {
    if (strcmp(full, "DINPUT.dll!DirectInputCreateA")) return 0;
    uint32_t out = argument(2);
    if (!out) { result(DI_INVALID, 4); return 1; }
    MEM32(out) = 0;
    if (argument(3)) { result(0x80040110, 4); return 1; }
    MEM32(out) = di_new(0); result(MEM32(out) ? 0 : 0x8007000E, 4); return 1;
}
#endif
