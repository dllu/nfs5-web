/* DirectSound PCM buffers and software mixing. Gain/sample conventions adapted
 * from pcrecomp/runtime/win32hle/dsound.c (MIT, copyright 2026 sp00nz). */
#ifndef NFS5_WIN32_DSOUND_H
#define NFS5_WIN32_DSOUND_H
#define DS_INVALID 0x80070057u
#define DS_UNSUPPORTED 0x80004001u
typedef struct { uint32_t address, references, cooperative; } ds_device;
typedef struct { uint32_t data, bytes, references; } ds_samples;
typedef struct {
    uint32_t address, references, owner, flags, samples, channels, bits, rate, original_rate, block;
    uint32_t playing, looping, locked, lock[4];
    int32_t volume, pan;
    double position;
    float left, right;
} ds_buffer;
static ds_device ds_devices[8];
static ds_buffer ds_buffers[64];
static ds_samples ds_data[64];
static uint32_t ds_device_table, ds_buffer_table, ds_selected, ds_mixed_frames;

static ds_device *ds_device_find(uint32_t address) {
    for (unsigned i = 0; i < 8; i++) if (ds_devices[i].references && ds_devices[i].address == address) return &ds_devices[i];
    return NULL;
}
static ds_buffer *ds_buffer_find(uint32_t address) {
    for (unsigned i = 0; i < 64; i++) if (ds_buffers[i].references && ds_buffers[i].address == address) return &ds_buffers[i];
    return NULL;
}
static void ds_tables(void) {
    if (ds_device_table) return;
    ds_device_table = allocate(44); ds_buffer_table = allocate(84);
    for (unsigned i = 0; i < 11; i++) MEM32(ds_device_table + i * 4) = 0xF3000000 + i * 4;
    for (unsigned i = 0; i < 21; i++) MEM32(ds_buffer_table + i * 4) = 0xF3000100 + i * 4;
}
static uint32_t ds_new_device(void) {
    ds_tables();
    for (unsigned i = 0; i < 8; i++) if (!ds_devices[i].references) {
        ds_device *device = &ds_devices[i]; *device = (ds_device){.address = allocate(8), .references = 1, .cooperative = 1};
        MEM32(device->address) = ds_device_table; MEM32(device->address + 4) = 1; return device->address;
    }
    return 0;
}
static void ds_gain(ds_buffer *buffer) {
    float volume = buffer->volume <= -10000 ? 0 : powf(10, buffer->volume / 2000.0f);
    buffer->left = volume * (buffer->pan > 0 ? powf(10, -buffer->pan / 2000.0f) : 1);
    buffer->right = volume * (buffer->pan < 0 ? powf(10, buffer->pan / 2000.0f) : 1);
    if (buffer->pan == 10000) buffer->left = 0;
    if (buffer->pan == -10000) buffer->right = 0;
}
static int ds_format(ds_buffer *buffer, uint32_t format) {
    if (!format) return 0;
    uint32_t channels = MEM16(format + 2), rate = MEM32(format + 4), block = MEM16(format + 12), bits = MEM16(format + 14);
    if (MEM16(format) != 1 || (channels != 1 && channels != 2) || (bits != 8 && bits != 16) ||
        rate < 100 || rate > 200000 || block != channels * bits / 8 || MEM32(format + 8) != rate * block) return 0;
    buffer->channels = channels; buffer->bits = bits; buffer->rate = buffer->original_rate = rate; buffer->block = block; return 1;
}
static uint32_t ds_new_buffer(ds_buffer *description, uint32_t bytes) {
    unsigned slot, sample;
    for (slot = 0; slot < 64 && ds_buffers[slot].references; slot++);
    if (slot == 64) return 0;
    if (description->samples) { sample = description->samples - 1; ds_data[sample].references++; }
    else {
        for (sample = 0; sample < 64 && ds_data[sample].references; sample++);
        if (sample == 64) return 0;
        ds_data[sample] = (ds_samples){.data = allocate(bytes), .bytes = bytes, .references = 1};
        if (description->bits == 8) memset((void *)ADDR(ds_data[sample].data), 128, bytes);
    }
    ds_buffer *buffer = &ds_buffers[slot]; *buffer = *description;
    buffer->samples = sample + 1; buffer->references = 1; buffer->address = allocate(8);
    buffer->locked = buffer->playing = buffer->looping = 0; buffer->position = 0; ds_gain(buffer);
    MEM32(buffer->address) = ds_buffer_table; MEM32(buffer->address + 4) = 1; return buffer->address;
}
static uint32_t ds_play_cursor(ds_buffer *buffer) {
    ds_samples *samples = &ds_data[buffer->samples - 1];
    return (uint32_t)buffer->position * buffer->block % samples->bytes;
}
static uint32_t ds_write_cursor(ds_buffer *buffer) {
    ds_samples *samples = &ds_data[buffer->samples - 1]; uint32_t play = ds_play_cursor(buffer);
    return (play + (buffer->playing ? buffer->rate / 100 * buffer->block : 0)) % samples->bytes;
}
static float ds_sample(ds_buffer *buffer, uint32_t frame, unsigned channel) {
    uint32_t data = ds_data[buffer->samples - 1].data + frame * buffer->block + (buffer->channels == 2 ? channel * buffer->bits / 8 : 0);
    return buffer->bits == 16 ? (int16_t)MEM16(data) / 32768.0f : ((int)MEM8(data) - 128) / 128.0f;
}
static void ds_mix(float *output, uint32_t frames, uint32_t rate) {
    memset(output, 0, frames * 2 * sizeof(float));
    for (unsigned i = 0; i < 64; i++) {
        ds_buffer *buffer = &ds_buffers[i];
        if (!buffer->references || !buffer->playing || (buffer->flags & 1)) continue;
        uint32_t count = ds_data[buffer->samples - 1].bytes / buffer->block;
        double step = (double)buffer->rate / rate;
        for (uint32_t frame = 0; frame < frames && buffer->playing; frame++) {
            uint32_t at = (uint32_t)buffer->position, next = at + 1;
            if (next >= count) next = buffer->looping ? 0 : at;
            float fraction = (float)(buffer->position - at);
            float left = ds_sample(buffer, at, 0), right = ds_sample(buffer, at, 1);
            left += (ds_sample(buffer, next, 0) - left) * fraction;
            right += (ds_sample(buffer, next, 1) - right) * fraction;
            output[frame * 2] += left * buffer->left; output[frame * 2 + 1] += right * buffer->right;
            buffer->position += step;
            if (buffer->position >= count) {
                if (buffer->looping) buffer->position = fmod(buffer->position, count);
                else { buffer->playing = 0; buffer->position = 0; }
            }
        }
    }
    for (uint32_t i = 0; i < frames * 2; i++) output[i] = fmaxf(-1, fminf(1, output[i]));
    ds_mixed_frames += frames;
}
static int ds_iid(uint32_t address, uint32_t first) {
    return address && MEM32(address) == first && MEM32(address + 4) == 0x11CE4981 &&
        MEM32(address + 8) == 0x200021A5 && MEM32(address + 12) == 0x60E50BAF;
}
static void ds_method(void) {
    uint32_t selected = ds_selected, method = (selected & 255) / 4, self = argument(0);
    machine_yield();
    ds_device *device = selected & 0x100 ? NULL : ds_device_find(self);
    ds_buffer *buffer = selected & 0x100 ? ds_buffer_find(self) : NULL;
    if (!device && !buffer) fail(g_cur_func, "DirectSound method %u on invalid object %08X", method, self);
    if (method == 0) {
        uint32_t iid = argument(1), out = argument(2);
        if (!out) { result(0x80004003, 3); return; }
        MEM32(out) = 0;
        int unknown = iid && !MEM32(iid) && !MEM32(iid + 4) && MEM32(iid + 8) == 0xC0 && MEM32(iid + 12) == 0x46000000;
        if (!unknown && !ds_iid(iid, device ? 0x279AFA83 : 0x279AFA85)) { result(0x80004002, 3); return; }
        MEM32(out) = self; MEM32(self + 4) = device ? ++device->references : ++buffer->references; result(0, 3); return;
    }
    if (method == 1 || method == 2) {
        uint32_t *refs = device ? &device->references : &buffer->references;
        uint32_t n = method == 1 ? ++*refs : --*refs; MEM32(self + 4) = n;
        if (!n) {
            if (buffer) {
                ds_samples *samples = &ds_data[buffer->samples - 1];
                if (!--samples->references) release_block(find_block(samples->data, 1));
            } else for (unsigned i = 0; i < 64; i++) if (ds_buffers[i].owner == self) ds_buffers[i].playing = 0;
            release_block(find_block(self, 1));
        }
        result(n, 1); return;
    }
    if (device) {
        if (method == 3) {
            uint32_t desc = argument(1), out = argument(2);
            if (!desc || !out || (MEM32(desc) != 20 && MEM32(desc) != 36)) { result(DS_INVALID, 4); return; }
            MEM32(out) = 0;
            if (argument(3)) { result(0x80040110, 4); return; }
            ds_buffer value = {.owner = self, .flags = MEM32(desc + 4), .channels = 2, .bits = 16, .rate = 22050, .original_rate = 22050, .block = 4};
            uint32_t bytes = MEM32(desc + 8), format = MEM32(desc + 16);
            if (value.flags & 4) { result(DS_UNSUPPORTED, 4); return; } /* no hardware voices */
            if (value.flags & 1) {
                if (format || bytes) { result(DS_INVALID, 4); return; }
                for (unsigned i = 0; i < 64; i++) if (ds_buffers[i].references && ds_buffers[i].owner == self && (ds_buffers[i].flags & 1)) {
                    MEM32(out) = ds_buffers[i].address; MEM32(MEM32(out) + 4) = ++ds_buffers[i].references; result(0, 4); return;
                }
                bytes = 16384;
            } else if (!ds_format(&value, format) || bytes < value.block || bytes > 8 * 1024 * 1024 || bytes % value.block) { result(DS_INVALID, 4); return; }
            MEM32(out) = ds_new_buffer(&value, bytes); result(MEM32(out) ? 0 : 0x8007000E, 4); return;
        }
        if (method == 4) {
            uint32_t out = argument(1);
            if (!out || MEM32(out) != 96) { result(DS_INVALID, 2); return; }
            memset((void *)ADDR(out + 4), 0, 92); MEM32(out + 4) = 0xF1F;
            MEM32(out + 8) = 100; MEM32(out + 12) = 200000; MEM32(out + 16) = 1; result(0, 2); return;
        }
        if (method == 5) {
            ds_buffer *source = ds_buffer_find(argument(1)); uint32_t out = argument(2);
            if (!source || !out || (source->flags & 1)) { result(DS_INVALID, 3); return; }
            MEM32(out) = ds_new_buffer(source, 0); result(MEM32(out) ? 0 : 0x8007000E, 3); return;
        }
        if (method == 6) {
            uint32_t level = argument(2);
            if (level < 1 || level > 4) { result(DS_INVALID, 3); return; }
            device->cooperative = level; result(0, 3); return;
        }
        if (method == 7) { result(0, 1); return; }
        if (method == 8) { if (!argument(1)) { result(DS_INVALID, 2); return; } MEM32(argument(1)) = 4; result(0, 2); return; }
        if (method == 9) { result(argument(1) == 4 ? 0 : DS_UNSUPPORTED, 2); return; }
        if (method == 10) { result(0x88780082, 2); return; }
    } else {
        ds_samples *samples = &ds_data[buffer->samples - 1];
        if (method == 3) {
            uint32_t out = argument(1);
            if (!out || MEM32(out) != 20) { result(DS_INVALID, 2); return; }
            MEM32(out + 4) = buffer->flags | 8; MEM32(out + 8) = samples->bytes; MEM32(out + 12) = MEM32(out + 16) = 0; result(0, 2); return;
        }
        if (method == 4) {
            if (argument(1)) MEM32(argument(1)) = ds_play_cursor(buffer);
            if (argument(2)) MEM32(argument(2)) = ds_write_cursor(buffer); result(0, 3); return;
        }
        if (method == 5) {
            uint32_t out = argument(1), size = argument(2), written = argument(3);
            if (written) MEM32(written) = 18;
            if (!out) { result(written ? 0 : DS_INVALID, 4); return; }
            if (size < 18) { result(DS_INVALID, 4); return; }
            MEM16(out) = 1; MEM16(out + 2) = buffer->channels; MEM32(out + 4) = buffer->original_rate;
            MEM32(out + 8) = buffer->original_rate * buffer->block; MEM16(out + 12) = buffer->block;
            MEM16(out + 14) = buffer->bits; MEM16(out + 16) = 0; result(0, 4); return;
        }
        if (method >= 6 && method <= 9) {
            if (!argument(1)) { result(DS_INVALID, 2); return; }
            MEM32(argument(1)) = method == 6 ? (uint32_t)buffer->volume : method == 7 ? (uint32_t)buffer->pan : method == 8 ? buffer->rate : buffer->playing ? 1 | (buffer->looping ? 4 : 0) : 0;
            result(0, 2); return;
        }
        if (method == 10) { result(0x88780082, 3); return; }
        if (method == 11) {
            uint32_t offset = argument(1), size = argument(2), flags = argument(7);
            if ((buffer->flags & 1) || buffer->locked) { result(0x88780032, 8); return; }
            if (!argument(3) || !argument(4) || flags > 2) { result(DS_INVALID, 8); return; }
            if (flags & 2) { offset = 0; size = samples->bytes; }
            if (flags & 1) offset = ds_write_cursor(buffer);
            if (offset >= samples->bytes || size > samples->bytes) { result(DS_INVALID, 8); return; }
            uint32_t first = size < samples->bytes - offset ? size : samples->bytes - offset;
            if (first < size && (!argument(5) || !argument(6))) { result(DS_INVALID, 8); return; }
            buffer->lock[0] = samples->data + offset; buffer->lock[1] = first;
            buffer->lock[2] = first < size ? samples->data : 0; buffer->lock[3] = size - first;
            for (unsigned i = 0; i < 4; i++) if (argument(3 + i)) MEM32(argument(3 + i)) = buffer->lock[i];
            buffer->locked = 1; result(0, 8); return;
        }
        if (method == 12) {
            if (argument(1) || argument(3) & ~1u) { result(DS_INVALID, 4); return; }
            buffer->playing = 1; buffer->looping = argument(3) & 1; result(0, 4); return;
        }
        if (method == 13) {
            if ((buffer->flags & 1) || argument(1) >= samples->bytes) { result(DS_INVALID, 2); return; }
            buffer->position = argument(1) / buffer->block; result(0, 2); return;
        }
        if (method == 14) {
            ds_device *owner = ds_device_find(buffer->owner);
            if (!(buffer->flags & 1)) { result(0x88780032, 2); return; }
            if (!owner || owner->cooperative < 2) { result(0x88780046, 2); return; }
            result(ds_format(buffer, argument(1)) ? 0 : DS_INVALID, 2); return;
        }
        if (method >= 15 && method <= 17) {
            int32_t value = (int32_t)argument(1);
            uint32_t control = method == 15 ? 0x80 : method == 16 ? 0x40 : 0x20;
            if (!(buffer->flags & control)) { result(0x8878001E, 2); return; }
            if ((method == 15 && (value < -10000 || value > 0)) || (method == 16 && (value < -10000 || value > 10000)) || (method == 17 && value && (value < 100 || value > 200000))) { result(DS_INVALID, 2); return; }
            if (method == 15) buffer->volume = value;
            if (method == 16) buffer->pan = value;
            if (method == 17) buffer->rate = value ? (uint32_t)value : buffer->original_rate;
            ds_gain(buffer); result(0, 2); return;
        }
        if (method == 18) { buffer->playing = 0; result(0, 1); return; }
        if (method == 19) {
            if (!buffer->locked) { result(DS_INVALID, 5); return; }
            for (unsigned i = 0; i < 4; i++) if (argument(1 + i) != buffer->lock[i]) { result(DS_INVALID, 5); return; }
            buffer->locked = 0; result(0, 5); return;
        }
        if (method == 20) { result(0, 1); return; }
    }
    fail(g_cur_func, "Unimplemented DirectSound %s method %u", device ? "device" : "buffer", method);
}
static recomp_func_t dsound_lookup(uint32_t address) {
    if (address >= 0xF3000000 && address < 0xF300002C && !(address & 3)) { ds_selected = address; return ds_method; }
    if (address >= 0xF3000100 && address < 0xF3000154 && !(address & 3)) { ds_selected = address; return ds_method; }
    return NULL;
}
static int dsound_import(const char *full) {
    if (!strcmp(full, "DSOUND.dll!ordinal_6")) {
        if (argument(1)) MEM32(argument(1)) = 0;
        result(0x88780078, 3); return 1; /* DirectSoundCaptureCreate: no capture device */
    }
    if (strcmp(full, "DSOUND.dll!ordinal_1")) return 0;
    uint32_t out = argument(1), guid = argument(0);
    if (!out) { result(DS_INVALID, 3); return 1; }
    MEM32(out) = 0;
    if (argument(2)) { result(0x80040110, 3); return 1; }
    if (guid && (MEM32(guid) || MEM32(guid + 4) || MEM32(guid + 8) || MEM32(guid + 12))) { result(0x88780078, 3); return 1; }
    MEM32(out) = ds_new_device(); result(MEM32(out) ? 0 : 0x8007000E, 3); return 1;
}
#endif
