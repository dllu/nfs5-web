/* Static asset files plus a bounded in-memory write overlay. All metadata,
 * handles, file offsets and cache entries are protected by the machine lock. */
#ifndef NFS5_WIN32_FILES_H
#define NFS5_WIN32_FILES_H
#define FS_NODES 4096
#define FS_WRITE_LIMIT (64u * 1024u * 1024u)
#define FS_CHUNK 262144u
typedef struct {
    char path[PATH_CAPACITY], url[PATH_CAPACITY];
    uint32_t attributes, size, capacity, live, dirty;
    uint64_t modified;
    uint8_t *data;
    const uint8_t *asset_data; /* Borrowed immutable startup pack, not a save. */
} fs_node;
typedef struct { uint32_t node, references, access, share, flags; uint64_t position; } fs_object;
typedef struct { uint32_t object, generation; } fs_handle;
typedef struct { uint32_t node, offset, size, stamp; uint8_t bytes[FS_CHUNK]; } fs_cache_entry;
typedef struct { uint32_t live, generation, cursor; char directory[PATH_CAPACITY], pattern[260]; } fs_search;
static fs_node fs_nodes[FS_NODES];
static fs_object fs_objects[256];
static fs_handle fs_handles[512];
static fs_cache_entry fs_cache[8];
static fs_search fs_searches[64];
static uint32_t fs_count, fs_cache_stamp, fs_written, fs_reads, fs_fetches, fs_revision;
static uint64_t fs_fetch_bytes,fs_preload_reads,fs_preload_bytes;
static double fs_fetch_ms,fs_fetch_max_ms;
static uint32_t *fs_snapshot_buffer;

/* Runs on the native worker performing ReadFile. HTTP Range keeps large VIV
 * archives out of startup memory; ordinary static hosts returning 200 also work.
 * The Node branch reads only the staged URL, never the original installation. */
EM_JS(int, fs_asset_read, (const char *address, uint32_t offset, uint32_t length, uint8_t *destination), {
    try {
        var url = UTF8ToString(address);
        if (ENVIRONMENT_IS_NODE) {
            var file = require('fs'), fd = file.openSync(new URL(url), 'r');
            try { return file.readSync(fd, HEAPU8, destination, length, offset); }
            finally { file.closeSync(fd); }
        }
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.responseType = 'arraybuffer';
        xhr.setRequestHeader('Range', 'bytes=' + offset + '-' + (offset + length - 1));
        xhr.send();
        if (xhr.status !== 200 && xhr.status !== 206) return -1;
        var bytes = new Uint8Array(xhr.response), start = xhr.status === 200 ? offset : 0;
        if (xhr.status === 206) {
            var range = new RegExp('^bytes ([0-9]+)-([0-9]+)/([0-9]+)$').exec(xhr.getResponseHeader('Content-Range') || "");
            if (!range || Number(range[1]) !== offset) return -1;
        }
        if (start + length > bytes.length) return -1;
        HEAPU8.set(bytes.subarray(start, start + length), destination);
        return length;
    } catch (error) { console.error('Asset read failed: ' + error); return -1; }
});

static uint64_t fs_filetime(double seconds) { return (uint64_t)((seconds + 11644473600.0) * 10000000.0); }
static void fs_touch(fs_node *node) { node->modified = fs_filetime(emscripten_date_now() / 1000); node->dirty = ++fs_revision; }
static int fs_equal(const char *a, const char *b) {
    for (; *a && *b; a++, b++) if (cp1252_case((uint8_t)*a, 1) != cp1252_case((uint8_t)*b, 1)) return 0;
    return *a == *b;
}
static void fs_strip(char *path) {
    size_t n = strlen(path); if (n > 3 && path[n - 1] == '\\') path[n - 1] = 0;
}
static fs_node *fs_find(const char *path) {
    for (uint32_t i = 0; i < fs_count; i++) if (fs_nodes[i].live && fs_equal(fs_nodes[i].path, path)) return &fs_nodes[i];
    return NULL;
}
static void fs_uncache(fs_node *node) {
    uint32_t id = (uint32_t)(node - fs_nodes) + 1;
    for (unsigned i = 0; i < 8; i++) if (fs_cache[i].node == id) fs_cache[i].node = fs_cache[i].stamp = 0;
}
static fs_node *fs_new(const char *path, uint32_t attributes) {
    fs_node *node = NULL;
    for (uint32_t i = 0; i < fs_count; i++) if (!fs_nodes[i].live && !fs_nodes[i].dirty) { node = &fs_nodes[i]; break; }
    if (!node && fs_count < FS_NODES) node = &fs_nodes[fs_count++];
    if (!node) { last_error = 8; return NULL; }
    fs_uncache(node);
    if(node->asset_data)fs_preload_bytes-=node->size;
    memset(node, 0, sizeof *node); strcpy(node->path, path); node->attributes = attributes; node->live = 1;
    fs_touch(node); return node;
}
static int fs_resolve(uint32_t address, char path[PATH_CAPACITY]) {
    if (!path_full(address ? (const char *)ADDR(address) : NULL, path)) return 0;
    fs_strip(path);
    if (path[0] != 'C' && path[0] != 'D') { last_error = 15; return 0; }
    return 1;
}
static int fs_parent(const char *path) {
    char parent[PATH_CAPACITY]; strcpy(parent, path);
    char *last = strrchr(parent, '\\');
    if (!last || strlen(parent) == 3) { last_error = 5; return 0; }
    if (last == parent + 2) last[1] = 0; else *last = 0;
    fs_node *node = fs_find(parent);
    if (!node || !(node->attributes & 16)) { last_error = 3; return 0; }
    return 1;
}
static void fs_reset(void) {
    for (uint32_t i = 0; i < fs_count; i++) free(fs_nodes[i].data);
    memset(fs_nodes, 0, sizeof fs_nodes); memset(fs_objects, 0, sizeof fs_objects);
    memset(fs_handles, 0, sizeof fs_handles); memset(fs_cache, 0, sizeof fs_cache);
    memset(fs_searches, 0, sizeof fs_searches);
    fs_count = fs_written = fs_reads = fs_fetches = fs_cache_stamp = fs_revision = 0;
    fs_fetch_bytes=fs_preload_reads=fs_preload_bytes=0;fs_fetch_ms=fs_fetch_max_ms=0;
    free(fs_snapshot_buffer); fs_snapshot_buffer = NULL;
    fs_new("C:\\", 16); fs_new("D:\\", 16); fs_new("C:\\nfs5", 16);
    for (unsigned i = 0; i < fs_count; i++) fs_nodes[i].dirty = 0;
}
static int fs_read_node(fs_node *node, uint32_t offset, uint32_t count, uint8_t *destination) {
    if (offset > node->size || count > node->size - offset) { last_error = 87; return 0; }
    fs_reads++;
    if (node->data) { memcpy(destination, node->data + offset, count); return 1; }
    if (node->asset_data) { memcpy(destination,node->asset_data+offset,count);fs_preload_reads++;return 1; }
    if (!count) return 1;
    if (!node->url[0]) { last_error = 30; return 0; }
    while (count) {
        uint32_t start = offset / FS_CHUNK * FS_CHUNK, id = (uint32_t)(node - fs_nodes) + 1;
        fs_cache_entry *cached = NULL;
        for (unsigned i = 0; i < 8; i++) if (fs_cache[i].node == id && fs_cache[i].offset == start) { cached = &fs_cache[i]; break; }
        if (!cached) {
            cached = &fs_cache[0];
            for (unsigned i = 1; i < 8; i++) if (fs_cache[i].stamp < cached->stamp) cached = &fs_cache[i];
            cached->node = 0; cached->size = node->size - start;
            if (cached->size > FS_CHUNK) cached->size = FS_CHUNK;
            fs_fetches++;
            double began=emscripten_get_now();int got=fs_asset_read(node->url,start,cached->size,cached->bytes);
            double elapsed=emscripten_get_now()-began;fs_fetch_ms+=elapsed;if(elapsed>fs_fetch_max_ms)fs_fetch_max_ms=elapsed;
            if(got>0)fs_fetch_bytes+=got;
            if (got != (int)cached->size) { last_error = 30; return 0; }
            cached->node = id; cached->offset = start;
        }
        cached->stamp = ++fs_cache_stamp;
        uint32_t available = cached->size - (offset - start), n = count < available ? count : available;
        memcpy(destination, cached->bytes + offset - start, n); destination += n; offset += n; count -= n;
    }
    return 1;
}
static int fs_resize(fs_node *node, uint32_t size, int preserve) {
    if(size<node->size&&mapping_node_active((uint32_t)(node-fs_nodes)+1)){last_error=1224;return 0;}
    uint32_t wanted = size > node->size && preserve ? size : preserve ? node->size : size;
    if (wanted > FS_WRITE_LIMIT || wanted > FS_WRITE_LIMIT - fs_written + node->capacity) { last_error = 112; return 0; }
    if (!node->data || wanted > node->capacity) {
        uint8_t *data = calloc(wanted ? wanted : 1, 1);
        if (!data) { last_error = 8; return 0; }
        if (preserve && node->size && !fs_read_node(node, 0, node->size, data)) { free(data); return 0; }
        free(node->data); fs_written -= node->capacity; node->data = data; node->capacity = wanted; fs_written += wanted;
    }
    if (size > node->size) memset(node->data + node->size, 0, size - node->size);
    if(node->asset_data){fs_preload_bytes-=node->size;node->asset_data=NULL;}
    node->size = size; node->url[0] = 0; fs_touch(node); return 1;
}
static fs_object *fs_get(uint32_t handle) {
    uint32_t slot = (handle & 0xFFF) / 4, generation = (handle >> 12) & 0xFFF;
    if ((handle & 0xFF000003) != 0x72000000 || slot >= 512 || !generation) return NULL;
    fs_handle *entry = &fs_handles[slot];
    return entry->object && entry->generation == generation ? &fs_objects[entry->object - 1] : NULL;
}
static uint32_t fs_reference(uint32_t object) {
    for (unsigned i = 0; i < 512; i++) if (!fs_handles[i].object && fs_handles[i].generation < 0xFFF) {
        fs_handles[i].object = object + 1; fs_handles[i].generation++; fs_objects[object].references++;
        return 0x72000000 | (fs_handles[i].generation << 12) | i * 4;
    }
    last_error = 4; return 0;
}
static void fs_close(uint32_t handle) {
    fs_object *object = fs_get(handle); fs_handles[(handle & 0xFFF) / 4].object = 0;
    if (!--object->references && (object->flags & 0x04000000)) {
        fs_node *node = &fs_nodes[object->node - 1]; node->live = 0;
        fs_touch(node);
        fs_written -= node->capacity; free(node->data); node->data = NULL; node->capacity = 0;
    }
}
static int fs_shares(fs_node *node, uint32_t access, uint32_t share) {
    uint32_t id = (uint32_t)(node - fs_nodes) + 1;
    for (unsigned i = 0; i < 256; i++) {
        fs_object *object = &fs_objects[i];
        if (!object->references || object->node != id) continue;
        if ((access & ~object->share) || (object->access & ~share)) { last_error = 32; return 0; }
    }
    return 1;
}
static int fs_wildcard(const char *pattern, const char *name) {
    if (fs_equal(pattern, "*.*")) pattern = "*";
    const char *star = NULL, *retry = NULL;
    while (*name) {
        if (*pattern == '?' || cp1252_case((uint8_t)*pattern, 1) == cp1252_case((uint8_t)*name, 1)) { pattern++; name++; }
        else if (*pattern == '*') { star = pattern++; retry = name; }
        else if (star) { pattern = star + 1; name = ++retry; }
        else return 0;
    }
    while (*pattern == '*') pattern++;
    return !*pattern || (*pattern == '.' && (!pattern[1] || (pattern[1] == '*' && !pattern[2])));
}
static int fs_find_next(fs_search *search, uint32_t output) {
    for (; search->cursor < fs_count;) {
        fs_node *node = &fs_nodes[search->cursor++]; if (!node->live) continue;
        const char *last = strrchr(node->path, '\\');
        if (!last || !last[1]) continue;
        char directory[PATH_CAPACITY]; size_t n = last - node->path;
        if (n == 2) n++;
        memcpy(directory, node->path, n); directory[n] = 0;
        if (!fs_equal(directory, search->directory) || !fs_wildcard(search->pattern, last + 1)) continue;
        memset((void *)ADDR(output), 0, 320); MEM32(output) = node->attributes;
        for (unsigned i = 0; i < 3; i++) { MEM32(output + 4 + i * 8) = (uint32_t)node->modified; MEM32(output + 8 + i * 8) = (uint32_t)(node->modified >> 32); }
        MEM32(output + 32) = node->size;
        snprintf((char *)ADDR(output + 44), 260, "%s", last + 1); return 1;
    }
    last_error = 18; return 0;
}

static int fs_import(const char *name) {
    if(!strcmp(name,"CopyFileA")) {
        char source_path[PATH_CAPACITY],destination_path[PATH_CAPACITY];
        if(!argument(0)||!argument(1)){last_error=87;result(0,3);return 1;}
        if(!fs_resolve(argument(0),source_path)||!fs_resolve(argument(1),destination_path)){result(0,3);return 1;}
        fs_node *source=fs_find(source_path),*destination=fs_find(destination_path);
        if(!source){last_error=fs_parent(source_path)?2:last_error;result(0,3);return 1;}
        if(source->attributes&16){last_error=5;result(0,3);return 1;}
        if(destination&&argument(2)){last_error=80;result(0,3);return 1;}
        if(destination==source){last_error=32;result(0,3);return 1;}
        if(destination_path[0]=='D'){last_error=19;result(0,3);return 1;}
        if(destination&&(destination->attributes&19)){last_error=5;result(0,3);return 1;}
        if(!destination&&!fs_parent(destination_path)){result(0,3);return 1;}
        if(!fs_shares(source,1,7)||(destination&&!fs_shares(destination,2,3))){result(0,3);return 1;}
        if(destination&&mapping_node_active((uint32_t)(destination-fs_nodes)+1)){last_error=1224;result(0,3);return 1;}
        if(!mapping_flush_node((uint32_t)(source-fs_nodes)+1)){result(0,3);return 1;}
        uint32_t size=source->size,old_capacity=destination?destination->capacity:0;
        if(size>FS_WRITE_LIMIT||size>FS_WRITE_LIMIT-fs_written+old_capacity){last_error=112;result(0,3);return 1;}
        uint8_t *copy=malloc(size?size:1);
        if(!copy){last_error=8;result(0,3);return 1;}
        /* Stage bytes before changing the destination, so an asset read or
         * allocation failure cannot destroy an existing browser-local save. */
        if(!fs_read_node(source,0,size,copy)){free(copy);result(0,3);return 1;}
        if(!destination&&!(destination=fs_new(destination_path,source->attributes))){free(copy);result(0,3);return 1;}
        fs_uncache(destination);free(destination->data);fs_written-=destination->capacity;
        destination->data=copy;destination->size=destination->capacity=size;fs_written+=size;
        destination->url[0]=0;destination->attributes=source->attributes;
        fs_touch(destination);destination->modified=source->modified;result(1,3);return 1;
    }
    if (!strcmp(name, "GetDiskFreeSpaceA")) {
        char path[PATH_CAPACITY];
        if (argument(0)) {
            if (!fs_resolve(argument(0), path)) { result(0, 5); return 1; }
        } else strcpy(path, path_cwd);
        for (unsigned i = 1; i < 5; i++) if (!argument(i)) { last_error = 87; result(0, 5); return 1; }
        uint64_t assets = 0;
        for (unsigned i = 0; i < fs_count; i++) if (fs_nodes[i].live) assets += fs_nodes[i].size;
        MEM32(argument(1)) = path[0] == 'D' ? 1 : 8; MEM32(argument(2)) = path[0] == 'D' ? 2048 : 512;
        MEM32(argument(3)) = path[0] == 'D' ? 0 : (FS_WRITE_LIMIT - fs_written) / 4096;
        MEM32(argument(4)) = path[0] == 'D' ? 350000 : (uint32_t)((assets + FS_WRITE_LIMIT + 4095) / 4096);
        result(1, 5); return 1;
    }
    if (!strcmp(name, "SetCurrentDirectoryA") || !strcmp(name, "GetShortPathNameA") || !strcmp(name, "CreateDirectoryA") || !strcmp(name, "SetFileAttributesA") || !strcmp(name, "DeleteFileA")) {
        char path[PATH_CAPACITY]; unsigned argc = !strcmp(name, "GetShortPathNameA") ? 3 : !strcmp(name, "CreateDirectoryA") || !strcmp(name, "SetFileAttributesA") ? 2 : 1;
        if (!fs_resolve(argument(0), path)) { result(0, argc); return 1; }
        fs_node *node = fs_find(path);
        if (!strcmp(name, "CreateDirectoryA")) {
            if (node) { last_error = 183; result(0, 2); return 1; }
            if (path[0] == 'D' || !fs_parent(path)) { if (path[0] == 'D') last_error = 19; result(0, 2); return 1; }
            result(fs_new(path, 16) != NULL, 2); return 1;
        }
        if (!node) { last_error = !strcmp(name, "SetCurrentDirectoryA") ? 3 : 2; result(0, argc); return 1; }
        if (!strcmp(name, "SetCurrentDirectoryA")) {
            if (!(node->attributes & 16)) { last_error = 267; result(0, 1); return 1; }
            strcpy(path_cwd, node->path); strcpy(path_drive_cwd[path_cwd[0] - 'A'], path_cwd); result(1, 1); return 1;
        }
        if (!strcmp(name, "GetShortPathNameA")) {
            uint32_t length = (uint32_t)strlen(node->path), size = argument(2), output = argument(1);
            if (size <= length) { result(length + 1, 3); return 1; }
            if (!output) { last_error = 87; result(0, 3); return 1; }
            /* This virtual volume has no 8.3 aliases. Windows permits returning
             * the unchanged long spelling on such volumes. */
            memcpy((void *)ADDR(output), node->path, length + 1); result(length, 3); return 1;
        }
        if (path[0] == 'D') { last_error = 5; result(0, argc); return 1; }
        if (!strcmp(name, "SetFileAttributesA")) {
            node->attributes = (node->attributes & 16) | (argument(1) & 0x2027);
            if (!node->attributes) node->attributes = 128;
            fs_touch(node); result(1, 2); return 1;
        }
        if (node->attributes & 1) { last_error = 5; result(0, argc); return 1; }
        if ((node->attributes & 16) || !fs_shares(node, 4, 7)) { if (node->attributes & 16) last_error = 5; result(0, 1); return 1; }
        for (unsigned i = 0; i < 256; i++) if (fs_objects[i].references && fs_objects[i].node == (uint32_t)(node - fs_nodes) + 1) { last_error = 32; result(0, 1); return 1; }
        node->live = 0; fs_touch(node); free(node->data); node->data = NULL; fs_written -= node->capacity; node->capacity = 0;
        result(1, 1); return 1;
    }
    if (!strcmp(name, "CreateFileA")) {
        char path[PATH_CAPACITY]; uint32_t desired = argument(1), share = argument(2), disposition = argument(4), flags = argument(5);
        if (!fs_resolve(argument(0), path)) { result(0xFFFFFFFF, 7); return 1; }
        if (disposition < 1 || disposition > 5 || (share & ~7u)) { last_error = 87; result(0xFFFFFFFF, 7); return 1; }
        if (flags & 0x40000000) { last_error = 50; result(0xFFFFFFFF, 7); return 1; }
        uint32_t access = ((desired & 0x80000000) ? 1 : 0) | ((desired & 0x40000000) ? 2 : 0) | ((desired & 0x10000) || (flags & 0x04000000) ? 4 : 0);
        if (desired & 0x10000000) access |= 3;
        fs_node *node = fs_find(path); int existed = node != NULL;
        if (node && disposition == 1) { last_error = 80; result(0xFFFFFFFF, 7); return 1; }
        if (!node && (disposition == 3 || disposition == 5)) { last_error = fs_parent(path) ? 2 : last_error; result(0xFFFFFFFF, 7); return 1; }
        if (path[0] == 'D' && (access & 6 || disposition != 3)) { last_error = 19; result(0xFFFFFFFF, 7); return 1; }
        if (node && ((node->attributes & 16) || ((node->attributes & 1) && (access & 6)))) { last_error = 5; result(0xFFFFFFFF, 7); return 1; }
        if (disposition == 5 && !(access & 2)) { last_error = 5; result(0xFFFFFFFF, 7); return 1; }
        if (node && !fs_shares(node, access, share)) { result(0xFFFFFFFF, 7); return 1; }
        unsigned slot;
        for (slot = 0; slot < 256; slot++) if (!fs_objects[slot].references) break;
        if (slot == 256) { last_error = 4; result(0xFFFFFFFF, 7); return 1; }
        if (!node) {
            if (!fs_parent(path) || !(node = fs_new(path, (flags & 0x27) | 32))) { result(0xFFFFFFFF, 7); return 1; }
        }
        if ((!existed || disposition == 2 || disposition == 5) && !fs_resize(node, 0, 0)) { result(0xFFFFFFFF, 7); return 1; }
        fs_objects[slot] = (fs_object){.node = (uint32_t)(node - fs_nodes) + 1, .access = access, .share = share, .flags = flags};
        uint32_t handle = fs_reference(slot);
        if (!handle) { result(0xFFFFFFFF, 7); return 1; }
        last_error = existed && (disposition == 2 || disposition == 4) ? 183 : 0;
        result(handle, 7); return 1;
    }
    if (!strcmp(name, "CloseHandle") && (argument(0) & 0xFF000000) == 0x72000000) {
        if (!fs_get(argument(0))) { last_error = 6; result(0, 1); return 1; }
        fs_close(argument(0)); result(1, 1); return 1;
    }
    if (!strcmp(name, "DuplicateHandle") && (argument(1) & 0xFF000000) == 0x72000000) {
        fs_object *object = fs_get(argument(1));
        if (!object || argument(0) != 0xFFFFFFFF || argument(2) != 0xFFFFFFFF || !argument(3)) { last_error = 6; result(0, 7); return 1; }
        if (!(argument(6) & 2)) { last_error = 50; result(0, 7); return 1; }
        uint32_t copy = fs_reference((uint32_t)(object - fs_objects));
        if (!copy) { result(0, 7); return 1; }
        if (argument(6) & 1) fs_close(argument(1)); MEM32(argument(3)) = copy; result(1, 7); return 1;
    }
    if (!strcmp(name, "ReadFile") || !strcmp(name, "WriteFile") || !strcmp(name, "SetFilePointer") || !strcmp(name, "SetEndOfFile") || !strcmp(name, "GetFileSize") || !strcmp(name, "FlushFileBuffers") || (!strcmp(name, "GetFileType") && (argument(0) & 0xFF000000) == 0x72000000)) {
        unsigned argc = !strcmp(name, "ReadFile") || !strcmp(name, "WriteFile") ? 5 : !strcmp(name, "SetFilePointer") ? 4 : !strcmp(name, "GetFileSize") ? 2 : 1;
        fs_object *object = fs_get(argument(0));
        if (!object) { last_error = 6; result(!strcmp(name, "SetFilePointer") || !strcmp(name, "GetFileSize") ? 0xFFFFFFFF : 0, argc); return 1; }
        fs_node *node = &fs_nodes[object->node - 1];
        if (!strcmp(name, "GetFileType")) { result(1, 1); return 1; }
        if (!strcmp(name, "GetFileSize")) { if (argument(1)) MEM32(argument(1)) = 0; result(node->size, 2); return 1; }
        if (!strcmp(name, "FlushFileBuffers")) { result(1, 1); return 1; }
        if (!strcmp(name, "SetFilePointer")) {
            uint32_t high = argument(2), method = argument(3);
            int64_t distance = high ? (int64_t)((uint64_t)MEM32(high) << 32 | argument(1)) : (int32_t)argument(1);
            int64_t start = method == 0 ? 0 : method == 1 ? object->position : node->size;
            int64_t position = start + distance;
            if (method > 2 || position < 0 || position > UINT32_MAX) { last_error = position < 0 ? 131 : 87; result(0xFFFFFFFF, 4); return 1; }
            object->position = position; if (high) MEM32(high) = 0; last_error = 0; result((uint32_t)position, 4); return 1;
        }
        int write = !strcmp(name, "WriteFile") || !strcmp(name, "SetEndOfFile");
        if (!(object->access & (write ? 2 : 1))) { last_error = 5; result(0, argc); return 1; }
        if (!strcmp(name, "SetEndOfFile")) { result(fs_resize(node, (uint32_t)object->position, 1), 1); return 1; }
        uint32_t buffer = argument(1), size = argument(2), transferred = argument(3), overlapped = argument(4);
        if (transferred) MEM32(transferred) = 0;
        if (overlapped) { last_error = 50; result(0, 5); return 1; }
        if (!transferred || (size && (!buffer || !web_guest_range(buffer,size)))) { last_error = 87; result(0, 5); return 1; }
        uint32_t n = size, offset = (uint32_t)object->position;
        if (write) {
            if (size > UINT32_MAX - offset) { last_error = 112; result(0, 5); return 1; }
            if (size && !fs_resize(node, offset + size > node->size ? offset + size : node->size, 1)) { result(0, 5); return 1; }
            if (size) memcpy(node->data + offset, (void *)ADDR(buffer), size);
        } else {
            if (offset >= node->size) n = 0; else if (n > node->size - offset) n = node->size - offset;
            if (n && !fs_read_node(node, offset, n, (uint8_t *)ADDR(buffer))) { result(0, 5); return 1; }
        }
        object->position += n; MEM32(transferred) = n; result(1, 5); return 1;
    }
    if (!strcmp(name, "FindFirstFileA")) {
        char path[PATH_CAPACITY]; uint32_t out = argument(1);
        if (!out || !fs_resolve(argument(0), path)) { if (!out) last_error = 87; result(0xFFFFFFFF, 2); return 1; }
        const char *source = (const char *)ADDR(argument(0)); size_t length = strlen(source);
        if (length && path_separator(source[length - 1])) { last_error = 2; result(0xFFFFFFFF, 2); return 1; }
        char *last = strrchr(path, '\\');
        if (!last || !last[1] || strlen(last + 1) >= 260) { last_error = 2; result(0xFFFFFFFF, 2); return 1; }
        for (unsigned i = 0; i < 64; i++) if (!fs_searches[i].live && fs_searches[i].generation < 0xFFFF) {
            fs_search *search = &fs_searches[i]; search->cursor = 0; strcpy(search->pattern, last + 1);
            if (last == path + 2) last[1] = 0; else *last = 0;
            strcpy(search->directory, path);
            if (!fs_find_next(search, out)) { last_error = fs_find(path) ? 2 : 3; result(0xFFFFFFFF, 2); return 1; }
            search->live = 1; search->generation++; result(0x73000000 | search->generation << 8 | i, 2); return 1;
        }
        last_error = 4; result(0xFFFFFFFF, 2); return 1;
    }
    if (!strcmp(name, "FindNextFileA") || !strcmp(name, "FindClose")) {
        uint32_t handle = argument(0), slot = handle & 0xFF, generation = (handle >> 8) & 0xFFFF;
        fs_search *search = slot < 64 ? &fs_searches[slot] : NULL; int closing = !strcmp(name, "FindClose");
        if ((handle & 0xFF000000) != 0x73000000 || !search || !search->live || search->generation != generation) { last_error = 6; result(0, closing ? 1 : 2); return 1; }
        if (closing) { search->live = 0; result(1, 1); return 1; }
        if (!argument(1)) { last_error = 87; result(0, 2); return 1; }
        result(fs_find_next(search, argument(1)), 2); return 1;
    }
    return 0;
}
#endif
