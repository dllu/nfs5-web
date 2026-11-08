/* Process-local UTF-16 environment, with ANSI setters and OEM byte snapshots. */
#ifndef NFS5_WIN32_ENVIRONMENT_H
#define NFS5_WIN32_ENVIRONMENT_H
static struct { uint16_t name[128], value[4096]; } process_environment[64];
static const uint16_t env_oem_high[128] = {
    0x00C7,0x00FC,0x00E9,0x00E2,0x00E4,0x00E0,0x00E5,0x00E7,0x00EA,0x00EB,0x00E8,0x00EF,0x00EE,0x00EC,0x00C4,0x00C5,
    0x00C9,0x00E6,0x00C6,0x00F4,0x00F6,0x00F2,0x00FB,0x00F9,0x00FF,0x00D6,0x00DC,0x00A2,0x00A3,0x00A5,0x20A7,0x0192,
    0x00E1,0x00ED,0x00F3,0x00FA,0x00F1,0x00D1,0x00AA,0x00BA,0x00BF,0x2310,0x00AC,0x00BD,0x00BC,0x00A1,0x00AB,0x00BB,
    0x2591,0x2592,0x2593,0x2502,0x2524,0x2561,0x2562,0x2556,0x2555,0x2563,0x2551,0x2557,0x255D,0x255C,0x255B,0x2510,
    0x2514,0x2534,0x252C,0x251C,0x2500,0x253C,0x255E,0x255F,0x255A,0x2554,0x2569,0x2566,0x2560,0x2550,0x256C,0x2567,
    0x2568,0x2564,0x2565,0x2559,0x2558,0x2552,0x2553,0x256B,0x256A,0x2518,0x250C,0x2588,0x2584,0x258C,0x2590,0x2580,
    0x03B1,0x00DF,0x0393,0x03C0,0x03A3,0x03C3,0x00B5,0x03C4,0x03A6,0x0398,0x03A9,0x03B4,0x221E,0x03C6,0x03B5,0x2229,
    0x2261,0x00B1,0x2265,0x2264,0x2320,0x2321,0x00F7,0x2248,0x00B0,0x2219,0x00B7,0x221A,0x207F,0x00B2,0x25A0,0x00A0,
};
static uint16_t env_upper(uint16_t c) { int byte = cp1252_encode(c); return byte < 0 ? c : cp1252_decode(cp1252_case((uint8_t)byte, 1)); }
static int env_compare(const uint16_t *a, const uint16_t *b) {
    for (; *a && *b; a++, b++) if (env_upper(*a) != env_upper(*b)) return env_upper(*a) < env_upper(*b) ? -1 : 1;
    return *a == *b ? 0 : *a ? 1 : -1;
}
static unsigned env_length(const uint16_t *text) { unsigned n = 0; while (text[n]) n++; return n; }
static int env_read(uint16_t *out, unsigned capacity, uint32_t address, int wide) {
    if (!address) return 0;
    for (unsigned i = 0; i < capacity; i++) {
        out[i] = wide ? MEM16(address + i * 2) : cp1252_decode(MEM8(address + i));
        if (!out[i]) return 1;
    }
    return 0;
}
static uint8_t env_oem(uint16_t c) {
    if (c < 128) return (uint8_t)c;
    for (unsigned i = 0; i < 128; i++) if (env_oem_high[i] == c) return i + 128;
    return '?';
}
static int environment_import(const char *name) {
    if (!strcmp(name, "SetEnvironmentVariableA") || !strcmp(name, "SetEnvironmentVariableW")) {
        uint16_t key[128], value[4096]; int wide = name[strlen(name) - 1] == 'W';
        if (!env_read(key, 128, argument(0), wide) || !key[0]) { last_error = 87; result(0, 2); return 1; }
        for (unsigned i = 0; key[i]; i++) if (key[i] == '=') { last_error = 87; result(0, 2); return 1; }
        unsigned slot;
        for (slot = 0; slot < 64; slot++) if (process_environment[slot].name[0] && !env_compare(process_environment[slot].name, key)) break;
        if (!argument(1)) {
            if (slot == 64) { last_error = 203; result(0, 2); return 1; }
            process_environment[slot].name[0] = 0; result(1, 2); return 1;
        }
        if (!env_read(value, 4096, argument(1), wide)) { last_error = 206; result(0, 2); return 1; }
        if (slot == 64) for (slot = 0; slot < 64 && process_environment[slot].name[0]; slot++);
        if (slot == 64) { last_error = 8; result(0, 2); return 1; }
        memcpy(process_environment[slot].name, key, (env_length(key) + 1) * 2);
        memcpy(process_environment[slot].value, value, (env_length(value) + 1) * 2); result(1, 2); return 1;
    }
    if (!strcmp(name, "GetEnvironmentStringsW") || !strcmp(name, "GetEnvironmentStrings")) {
        int wide = !strcmp(name, "GetEnvironmentStringsW"); unsigned indices[64], count = 0, length = 1;
        for (unsigned i = 0; i < 64; i++) if (process_environment[i].name[0]) {
            unsigned at = count;
            while (at && env_compare(process_environment[indices[at - 1]].name, process_environment[i].name) > 0) { indices[at] = indices[at - 1]; at--; }
            indices[at] = i; count++;
            length += env_length(process_environment[i].name) + env_length(process_environment[i].value) + 2;
        }
        if (!count) length++;
        uint32_t block = allocate_kind(length * (wide ? 2 : 1), 16, wide ? 4 : 3), out = block;
        for (unsigned i = 0; i < count; i++) {
            const uint16_t *parts[] = {process_environment[indices[i]].name, process_environment[indices[i]].value};
            for (unsigned part = 0; part < 2; part++) {
                for (const uint16_t *p = parts[part]; *p; p++) {
                    if (wide) { MEM16(out) = *p; out += 2; } else MEM8(out++) = env_oem(*p);
                }
                if (wide) { MEM16(out) = part ? 0 : '='; out += 2; } else MEM8(out++) = part ? 0 : '=';
            }
        }
        result(block, 0); return 1;
    }
    if (!strcmp(name, "FreeEnvironmentStringsW") || !strcmp(name, "FreeEnvironmentStringsA")) {
        guest_block *block = find_block(argument(0), !strcmp(name, "FreeEnvironmentStringsW") ? 4 : 3);
        if (!block) { last_error = 87; result(0, 1); return 1; }
        release_block(block); result(1, 1); return 1;
    }
    return 0;
}
#endif
