/* Process-wide DOS paths. Filesystem lookup is case insensitive; returned
 * spellings retain the caller's case. Network/device namespaces are absent. */
#ifndef NFS5_WIN32_PATHS_H
#define NFS5_WIN32_PATHS_H
#define PATH_CAPACITY 1024
static char path_cwd[PATH_CAPACITY] = "C:\\nfs5";
static char path_drive_cwd[26][PATH_CAPACITY];

static int path_separator(char c) { return c == '\\' || c == '/'; }
static void path_reset(void) {
    strcpy(path_cwd, "C:\\nfs5");
    for (unsigned i = 0; i < 26; i++) snprintf(path_drive_cwd[i], PATH_CAPACITY, "%c:\\", 'A' + i);
    strcpy(path_drive_cwd[2], path_cwd);
}
static int path_full(const char *source, char out[PATH_CAPACITY]) {
    if (!source || !*source) { last_error = 123; return 0; }
    size_t length = strnlen(source, PATH_CAPACITY);
    if (length == PATH_CAPACITY) { last_error = 206; return 0; }
    if (path_separator(source[0]) && path_separator(source[1])) { last_error = 53; return 0; }
    unsigned drive = path_cwd[0] - 'A';
    const char *tail = source, *prefix = path_cwd;
    if (source[1] == ':') {
        uint8_t letter = cp1252_case((uint8_t)source[0], 1);
        if (letter < 'A' || letter > 'Z') { last_error = 123; return 0; }
        drive = letter - 'A'; tail += 2; prefix = path_drive_cwd[drive];
    }
    char combined[PATH_CAPACITY];
    if (path_separator(*tail)) {
        if (strlen(tail) + 3 > sizeof combined) { last_error = 206; return 0; }
        snprintf(combined, sizeof combined, "%c:%s", 'A' + drive, tail);
    } else {
        if (strlen(prefix) + length + 2 >= sizeof combined) { last_error = 206; return 0; }
        snprintf(combined, sizeof combined, "%s\\%s", prefix, tail);
    }
    out[0] = 'A' + drive; out[1] = ':'; out[2] = '\\'; out[3] = 0;
    size_t used = 3, starts[PATH_CAPACITY / 2], depth = 0;
    const char *p = combined + 2;
    while (*p) {
        while (path_separator(*p)) p++;
        if (!*p) break;
        const char *begin = p;
        while (*p && !path_separator(*p)) p++;
        size_t n = p - begin;
        if (n == 1 && begin[0] == '.') continue;
        if (n == 2 && begin[0] == '.' && begin[1] == '.') {
            if (depth) used = starts[--depth];
            out[used] = 0; continue;
        }
        for (size_t i = 0; i < n; i++) if ((uint8_t)begin[i] < 32 || strchr("<>:\"|", begin[i])) {
            last_error = 123; return 0;
        }
        while (n && (begin[n - 1] == ' ' || begin[n - 1] == '.')) n--;
        if (!n) continue;
        size_t before = used;
        if (used > 3) out[used++] = '\\';
        if (used + n + 2 >= PATH_CAPACITY) { last_error = 206; return 0; }
        starts[depth++] = before; memcpy(out + used, begin, n); used += n; out[used] = 0;
    }
    if (used > 3 && length && path_separator(source[length - 1])) out[used++] = '\\';
    out[used] = 0; return 1;
}
static int path_import(const char *name) {
    if (!strcmp(name, "GetFullPathNameA")) {
        uint32_t source = argument(0), capacity = argument(1), out = argument(2), part = argument(3);
        char path[PATH_CAPACITY];
        if (!path_full(source ? (const char *)ADDR(source) : NULL, path)) { result(0, 4); return 1; }
        uint32_t length = (uint32_t)strlen(path);
        if (capacity <= length) { result(length + 1, 4); return 1; }
        if (!out) { last_error = 87; result(0, 4); return 1; }
        memcpy((void *)ADDR(out), path, length + 1);
        if (part) {
            char *last = strrchr(path, '\\');
            MEM32(part) = last && last[1] ? out + (uint32_t)(last - path) + 1 : 0;
        }
        result(length, 4); return 1;
    }
    if (!strcmp(name, "GetCurrentDirectoryA")) {
        uint32_t capacity = argument(0), out = argument(1), length = (uint32_t)strlen(path_cwd);
        if (capacity <= length) { result(length + 1, 2); return 1; }
        if (!out) { last_error = 87; result(0, 2); return 1; }
        memcpy((void *)ADDR(out), path_cwd, length + 1); result(length, 2); return 1;
    }
    if (!strcmp(name, "GetLogicalDrives")) { result((1u << 2) | (1u << 3), 0); return 1; }
    if (!strcmp(name, "GetLogicalDriveStringsA")) {
        static const char drives[] = "C:\\\0D:\\\0";
        uint32_t capacity = argument(0), out = argument(1);
        if (capacity < sizeof drives) { result(sizeof drives, 2); return 1; }
        if (!out) { last_error = 87; result(0, 2); return 1; }
        memcpy((void *)ADDR(out), drives, sizeof drives); result(sizeof drives - 1, 2); return 1;
    }
    return 0;
}
#endif
