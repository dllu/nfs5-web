/* Per-application registry. It never reads or writes a host OS registry;
 * changes serialize into the existing browser-persisted virtual filesystem. */
#ifndef NFS5_WIN32_REGISTRY_H
#define NFS5_WIN32_REGISTRY_H
#define REG_FILE "C:\\nfs5\\.web-registry.bin"
typedef struct { uint32_t hive; char path[512]; } reg_key;
typedef struct { uint32_t key, type, size; char name[128]; uint8_t data[4096]; } reg_value;
typedef struct { uint32_t key, generation, access; } reg_handle;
static reg_key reg_keys[128];
static reg_value reg_values[256];
static reg_handle reg_handles[256];
static uint32_t reg_key_count, reg_value_count;

static int reg_root(uint32_t hive) { return hive >= 0x80000000 && hive <= 0x80000003 || hive == 0x80000005; }
static reg_key *reg_get(uint32_t handle, uint32_t access) {
    if (reg_root(handle)) {
        for (unsigned i = 0; i < reg_key_count; i++) if (reg_keys[i].hive == handle && !reg_keys[i].path[0]) return &reg_keys[i];
        return NULL;
    }
    unsigned slot = (handle & 0xFFF) / 4, generation = (handle >> 12) & 0xFFF;
    if ((handle & 0xFF000003) != 0x79000000 || slot >= 256 || !generation) return NULL;
    reg_handle *entry = &reg_handles[slot];
    if (!entry->key || entry->generation != generation || (entry->access & access) != access) return NULL;
    return &reg_keys[entry->key - 1];
}
static uint32_t reg_reference(reg_key *key, uint32_t access) {
    for (unsigned i = 0; i < 256; i++) if (!reg_handles[i].key && reg_handles[i].generation < 0xFFF) {
        reg_handles[i].key = (uint32_t)(key - reg_keys) + 1; reg_handles[i].access = access; reg_handles[i].generation++;
        return 0x79000000 | reg_handles[i].generation << 12 | i * 4;
    }
    return 0;
}
static reg_key *reg_find(uint32_t hive, const char *path) {
    for (unsigned i = 0; i < reg_key_count; i++) if (reg_keys[i].hive == hive && fs_equal(reg_keys[i].path, path)) return &reg_keys[i];
    return NULL;
}
static reg_key *reg_create(uint32_t hive, const char *path) {
    if (strlen(path) >= sizeof reg_keys[0].path) return NULL;
    char current[512] = ""; const char *cursor = path;
    reg_key *key = reg_find(hive, "");
    while (*cursor) {
        while (*cursor == '\\') cursor++;
        if (!*cursor) break;
        const char *start = cursor; while (*cursor && *cursor != '\\') cursor++;
        size_t length = strlen(current), count = cursor - start;
        if (length) current[length++] = '\\';
        memcpy(current + length, start, count); current[length + count] = 0;
        key = reg_find(hive, current);
        if (!key) {
            if (reg_key_count == 128) return NULL;
            key = &reg_keys[reg_key_count++]; key->hive = hive; strcpy(key->path, current);
        }
    }
    return key;
}
static reg_value *reg_value_find(reg_key *key, const char *name) {
    uint32_t index = (uint32_t)(key - reg_keys) + 1;
    for (unsigned i = 0; i < reg_value_count; i++) if (reg_values[i].key == index && fs_equal(reg_values[i].name, name)) return &reg_values[i];
    return NULL;
}
static int reg_assign(reg_key *key, const char *name, uint32_t type, const void *data, uint32_t size) {
    if (strlen(name) >= 128 || size > 4096) return 0;
    reg_value *value = reg_value_find(key, name);
    if (!value) {
        if (reg_value_count == 256) return 0;
        value = &reg_values[reg_value_count++]; memset(value, 0, sizeof *value);
        value->key = (uint32_t)(key - reg_keys) + 1; strcpy(value->name, name);
    }
    value->type = type; value->size = size; if (size) memcpy(value->data, data, size); return 1;
}
static void reg_seed_key(const char *path) {
    reg_key *key = reg_create(0x80000002, path);
    static const char *pairs[][2] = {
        {"DisplayName", "Need For Speed - Porsche Unleashed"}, {"Language", "English"}, {"LanguageName", "English"},
        {"Install Dir", "C:\\nfs5\\"}, {"CD Drive", "D:\\"}, {"3D Card", "OpenGL 3"},
        {"3D Device Description", "OpenGL 3"}, {"Thrash Driver", "opengl3"}, {"Group", "OpenGL"}, {"Thrash Resolution", "1920x1080"},
    };
    for (unsigned i = 0; i < sizeof pairs / sizeof pairs[0]; i++) reg_assign(key, pairs[i][0], 1, pairs[i][1], (uint32_t)strlen(pairs[i][1]) + 1);
    uint32_t zero = 0, one = 1;
    reg_assign(key, "D3D Device", 4, &zero, 4); reg_assign(key, "Triple Buffer", 4, &zero, 4); reg_assign(key, "Hardware Acceleration", 4, &one, 4);
}
static void reg_reset(void) {
    memset(reg_keys, 0, sizeof reg_keys); memset(reg_values, 0, sizeof reg_values); memset(reg_handles, 0, sizeof reg_handles);
    reg_key_count = reg_value_count = 0;
    for (uint32_t hive = 0x80000000; hive <= 0x80000005; hive++) if (reg_root(hive)) reg_keys[reg_key_count++].hive = hive;
    reg_seed_key("Software\\Electronic Arts\\Need For Speed - Porsche Unleashed");
    reg_seed_key("Software\\Electronic Arts\\Need For Speed - Porsche Unleashed\\1.0");
}
static int reg_flush(void) {
    uint32_t length = 16;
    for (unsigned i = 0; i < reg_key_count; i++) length += 8 + (uint32_t)strlen(reg_keys[i].path) + 1;
    for (unsigned i = 0; i < reg_value_count; i++) length += 16 + (uint32_t)strlen(reg_values[i].name) + 1 + reg_values[i].size;
    uint8_t *bytes = malloc(length); if (!bytes) return 8;
    uint32_t header[] = {0x5246534E, 1, reg_key_count, reg_value_count}; memcpy(bytes, header, 16);
    uint8_t *cursor = bytes + 16;
    for (unsigned i = 0; i < reg_key_count; i++) {
        uint32_t n = (uint32_t)strlen(reg_keys[i].path) + 1, fields[] = {reg_keys[i].hive, n};
        memcpy(cursor, fields, 8); cursor += 8; memcpy(cursor, reg_keys[i].path, n); cursor += n;
    }
    for (unsigned i = 0; i < reg_value_count; i++) {
        reg_value *value = &reg_values[i]; uint32_t n = (uint32_t)strlen(value->name) + 1;
        uint32_t fields[] = {value->key, value->type, n, value->size}; memcpy(cursor, fields, 16); cursor += 16;
        memcpy(cursor, value->name, n); cursor += n; memcpy(cursor, value->data, value->size); cursor += value->size;
    }
    fs_node *file = fs_find(REG_FILE); if (!file) file = fs_new(REG_FILE, 2);
    int status = file && fs_resize(file, length, 0) ? 0 : (int)last_error;
    if (!status) memcpy(file->data, bytes, length);
    free(bytes); return status;
}
static int reg_restore(void) {
    fs_node *file = fs_find(REG_FILE); if (!file) return 1;
    if (file->size < 16 || file->size > 2 * 1024 * 1024) return 0;
    uint8_t *bytes = malloc(file->size); if (!bytes) return 0;
    if (!fs_read_node(file, 0, file->size, bytes)) { free(bytes); return 0; }
    uint32_t header[4]; memcpy(header, bytes, 16);
    if (header[0] != 0x5246534E || header[1] != 1 || header[2] < 5 || header[2] > 128 || header[3] > 256) { free(bytes); return 0; }
    reg_key *keys = calloc(128, sizeof *keys); reg_value *values = calloc(256, sizeof *values);
    if (!keys || !values) { free(keys); free(values); free(bytes); return 0; }
    uint8_t *cursor = bytes + 16, *end = bytes + file->size; int valid = 1;
    for (unsigned i = 0; i < header[2] && valid; i++) {
        uint32_t fields[2]; if (end - cursor < 8) { valid = 0; break; }
        memcpy(fields, cursor, 8); cursor += 8;
        if (!reg_root(fields[0]) || !fields[1] || fields[1] > 512 || end - cursor < fields[1] || cursor[fields[1] - 1] || memchr(cursor, 0, fields[1] - 1)) { valid = 0; break; }
        keys[i].hive = fields[0]; memcpy(keys[i].path, cursor, fields[1]); cursor += fields[1];
    }
    for (unsigned i = 0; i < header[3] && valid; i++) {
        uint32_t fields[4]; if (end - cursor < 16) { valid = 0; break; }
        memcpy(fields, cursor, 16); cursor += 16;
        if (!fields[0] || fields[0] > header[2] || !fields[2] || fields[2] > 128 || fields[3] > 4096 || end - cursor < fields[2] + fields[3] || cursor[fields[2] - 1] || memchr(cursor, 0, fields[2] - 1)) { valid = 0; break; }
        reg_value *value = &values[i]; value->key = fields[0]; value->type = fields[1]; value->size = fields[3];
        memcpy(value->name, cursor, fields[2]); cursor += fields[2]; memcpy(value->data, cursor, fields[3]); cursor += fields[3];
    }
    valid = valid && cursor == end;
    for (uint32_t hive = 0x80000000; valid && hive <= 0x80000005; hive++) if (reg_root(hive)) {
        int found = 0;
        for (unsigned i = 0; i < header[2]; i++) if (keys[i].hive == hive && !keys[i].path[0]) found++;
        if (found != 1) valid = 0;
    }
    if (valid) { memcpy(reg_keys, keys, sizeof reg_keys); memcpy(reg_values, values, sizeof reg_values); reg_key_count = header[2]; reg_value_count = header[3]; }
    free(keys); free(values); free(bytes); return valid;
}
static int reg_import(const char *name) {
    if (!strcmp(name, "RegOpenKeyA") || !strcmp(name, "RegOpenKeyExA") || !strcmp(name, "RegCreateKeyA")) {
        int extended = !strcmp(name, "RegOpenKeyExA"), create = !strcmp(name, "RegCreateKeyA"); unsigned argc = extended ? 5 : 3;
        uint32_t out = argument(extended ? 4 : 2), access = extended ? argument(3) & ~0x300u : 0xF003F;
        reg_key *parent = reg_get(argument(0), create ? 4 : 0);
        if (!parent) { result(reg_get(argument(0), 0) ? 5 : 6, argc); return 1; }
        if (!out || (extended && argument(2))) { result(87, argc); return 1; }
        MEM32(out) = 0;
        const char *name = argument(1) ? (const char *)ADDR(argument(1)) : "";
        char path[512];
        if (strlen(parent->path) + strlen(name) + 2 > sizeof path) { result(206, argc); return 1; }
        snprintf(path, sizeof path, "%s%s%s", parent->path, *parent->path && *name ? "\\" : "", name);
        size_t length = strlen(path); while (length && path[length - 1] == '\\') path[--length] = 0;
        reg_key *key = reg_find(parent->hive, path);
        if (!key && create) {
            key = reg_create(parent->hive, path);
            if (!key) { result(8, argc); return 1; }
            int status = reg_flush(); if (status) { result(status, argc); return 1; }
        }
        if (!key) { result(2, argc); return 1; }
        MEM32(out) = reg_reference(key, access); result(MEM32(out) ? 0 : 8, argc); return 1;
    }
    if (!strcmp(name, "RegCloseKey") || !strcmp(name, "RegFlushKey")) {
        uint32_t handle = argument(0); reg_key *key = reg_get(handle, 0);
        if (!key) { result(6, 1); return 1; }
        if (!strcmp(name, "RegFlushKey")) { result(reg_flush(), 1); return 1; }
        if (!reg_root(handle)) reg_handles[(handle & 0xFFF) / 4].key = 0;
        result(0, 1); return 1;
    }
    if (!strcmp(name, "RegQueryValueExA")) {
        reg_key *key = reg_get(argument(0), 1);
        if (!key) { result(reg_get(argument(0), 0) ? 5 : 6, 6); return 1; }
        uint32_t data = argument(4), size = argument(5), type = argument(3);
        if (argument(2) || (data && !size)) { result(87, 6); return 1; }
        const char *name = argument(1) ? (const char *)ADDR(argument(1)) : "";
        reg_value *value = reg_value_find(key, name);
        if (!value) { result(2, 6); return 1; }
        if (type) MEM32(type) = value->type;
        uint32_t capacity = size ? MEM32(size) : 0;
        if (size) MEM32(size) = value->size;
        if (data && capacity < value->size) { result(234, 6); return 1; }
        if (data && value->size) memcpy((void *)ADDR(data), value->data, value->size);
        result(0, 6); return 1;
    }
    if (!strcmp(name, "RegSetValueExA")) {
        reg_key *key = reg_get(argument(0), 2);
        if (!key) { result(reg_get(argument(0), 0) ? 5 : 6, 6); return 1; }
        uint32_t type = argument(3), data = argument(4), size = argument(5);
        if (argument(2) || size > 4096 || (size && (!data || data >= GUEST_SIZE || size > GUEST_SIZE - data))) { result(87, 6); return 1; }
        const char *name = argument(1) ? (const char *)ADDR(argument(1)) : "";
        reg_value *previous = reg_value_find(key, name), old;
        uint32_t count = reg_value_count;
        if (previous) old = *previous;
        if (!reg_assign(key, name, type, (const void *)ADDR(data), size)) { result(8, 6); return 1; }
        int status = reg_flush();
        if (status) { if (previous) *previous = old; reg_value_count = count; }
        result(status, 6); return 1;
    }
    return 0;
}
#endif
