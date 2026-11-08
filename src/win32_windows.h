/* Desktop identity, device-context lifetimes and logical display geometry. */
#ifndef NFS5_WIN32_WINDOWS_H
#define NFS5_WIN32_WINDOWS_H
#define WIN_DESKTOP 0x74000001u
typedef struct {
    uint32_t handle, generation, owner, procedure, atom, instance, parent, menu, style, extended, user, extra, extra_size;
    int32_t x, y, width, height, left, top, right, bottom;
    uint32_t visible, iconic, destroying, paint, dc_refs;
    char title[260];
} guest_window;
static guest_window win_windows[64];
static uint32_t win_foreground, win_focus;
static int32_t win_cursor_count;
static uint32_t win_cursor;

static guest_window *win_get(uint32_t handle) {
    for (unsigned i = 0; i < 64; i++) if (win_windows[i].handle && win_windows[i].handle == handle) return &win_windows[i];
    return NULL;
}
static void win_reset(void) {
    memset(win_windows, 0, sizeof win_windows);
    win_windows[0] = (guest_window){.handle = WIN_DESKTOP, .style = 0x90000000, .width = 1920, .height = 1080, .visible = 1};
    strcpy(win_windows[0].title, "Desktop"); win_foreground = win_focus = 0;
    win_cursor_count = 0; win_cursor = 0x76007F00;
}
static int win_import(const char *name) {
    if (!strcmp(name, "GetDesktopWindow")) { result(WIN_DESKTOP, 0); return 1; }
    if (!strcmp(name, "GetForegroundWindow")) { result(di_focused ? win_foreground : 0, 0); return 1; }
    if (!strcmp(name, "GetWindowDC")) {
        guest_window *window = win_get(argument(0) ? argument(0) : WIN_DESKTOP);
        if (!window) { last_error = 1400; result(0, 1); return 1; }
        window->dc_refs++; result(0x75000000 | (window->handle & 0x00FFFFFF), 1); return 1;
    }
    if (!strcmp(name, "ReleaseDC")) {
        guest_window *window = win_get(argument(0) ? argument(0) : WIN_DESKTOP);
        if (!window || !window->dc_refs || argument(1) != (0x75000000 | (window->handle & 0x00FFFFFF))) { result(0, 2); return 1; }
        window->dc_refs--; result(1, 2); return 1;
    }
    if (!strcmp(name, "GetSystemMetrics")) {
        uint32_t value = 0;
        switch (argument(0)) {
        case 0: case 16: case 78: value = win_windows[0].width; break;
        case 1: case 79: value = win_windows[0].height; break;
        case 17: value = win_windows[0].height - 23; break;
        case 2: case 3: case 9: case 10: case 20: case 21: value = 17; break;
        case 4: value = 23; break; case 5: case 6: case 19: case 80: value = 1; break;
        case 7: case 8: case 43: value = 3; break;
        case 11: case 12: case 13: case 14: value = 32; break; case 15: value = 19; break;
        case 28: case 34: value = 112; break; case 29: case 35: value = 27; break;
        case 30: case 31: value = 18; break; case 32: case 33: value = 8; break;
        }
        result(value, 1); return 1;
    }
    if (!strcmp(name, "LoadIconA") || !strcmp(name, "LoadCursorA")) {
        uint32_t resource = argument(1);
        if (!resource || resource > 0xFFFF) { last_error = 1813; result(0, 2); return 1; }
        result((!strcmp(name, "LoadCursorA") ? 0x76000000 : 0x77000000) | resource, 2); return 1;
    }
    if (!strcmp(name, "SetCursor")) { uint32_t old = win_cursor; win_cursor = argument(0); result(old, 1); return 1; }
    if (!strcmp(name, "ShowCursor")) { win_cursor_count += argument(0) ? 1 : -1; result((uint32_t)win_cursor_count, 1); return 1; }
    if (!strcmp(name, "GetWindowLongA")) {
        guest_window *window = win_get(argument(0)); int32_t index = (int32_t)argument(1);
        if (!window) { last_error = 1400; result(0, 2); return 1; }
        uint32_t value;
        switch (index) {
        case -4: value = window->procedure; break; case -6: value = window->instance; break;
        case -8: value = window->parent; break; case -12: value = window->menu; break;
        case -16: value = window->style; break; case -20: value = window->extended; break;
        case -21: value = window->user; break;
        default:
            if (index < 0 || index % 4 || (uint32_t)index + 4 > window->extra_size) { last_error = 1413; result(0, 2); return 1; }
            value = MEM32(window->extra + index);
        }
        result(value, 2); return 1;
    }
    if (!strcmp(name, "GetClientRect")) {
        guest_window *window = win_get(argument(0)); uint32_t out = argument(1);
        if (!window || !out) { last_error = window ? 87 : 1400; result(0, 2); return 1; }
        MEM32(out) = MEM32(out + 4) = 0;
        MEM32(out + 8) = window->width - window->left - window->right;
        MEM32(out + 12) = window->height - window->top - window->bottom; result(1, 2); return 1;
    }
    if (!strcmp(name, "ScreenToClient") || !strcmp(name, "ClientToScreen")) {
        guest_window *window = win_get(argument(0)); uint32_t point = argument(1);
        if (!window || !point) { last_error = window ? 87 : 1400; result(0, 2); return 1; }
        int sign = !strcmp(name, "ClientToScreen") ? 1 : -1;
        MEM32(point) += sign * (window->x + window->left); MEM32(point + 4) += sign * (window->y + window->top);
        result(1, 2); return 1;
    }
    return 0;
}
static int win_gdi_import(const char *name) {
    if (!strcmp(name, "GetStockObject")) { uint32_t index = argument(0); result(index <= 19 ? 0x78000000 | index : 0, 1); return 1; }
    if (!strcmp(name, "GetDeviceCaps")) {
        uint32_t dc = argument(0), value = 0;
        guest_window *window = (dc & 0xFF000000) == 0x75000000 ? win_get(0x74000000 | (dc & 0xFFFFFF)) : NULL;
        if (!window || !window->dc_refs) { last_error = 6; result(0, 2); return 1; }
        switch (argument(1)) {
        case 0: value = 0x400; break; case 2: value = 1; break;
        case 4: value = win_windows[0].width * 254 / 960; break;
        case 6: value = win_windows[0].height * 254 / 960; break;
        case 8: case 118: value = win_windows[0].width; break;
        case 10: case 117: value = win_windows[0].height; break;
        case 12: value = 32; break; case 14: case 116: value = 1; break;
        case 24: value = 0xFFFFFFFF; break; case 88: case 90: value = 96; break;
        }
        result(value, 2); return 1;
    }
    return 0;
}
#endif
