/* CP1252 helpers adapted from pcrecomp runtime/win32hle/kernel32_crt.c.
 * MIT, copyright 2026 sp00nz; see the pinned submodule's LICENSE. */
#ifndef NFS5_WIN32_LOCALE_H
#define NFS5_WIN32_LOCALE_H

static const uint16_t cp1252_high[32] = {
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
};

static uint16_t cp1252_decode(uint8_t c) {
    return c >= 0x80 && c < 0xA0 ? cp1252_high[c - 0x80] : c;
}

static int cp1252_encode(uint16_t c) {
    if (c < 0x80 || (c >= 0xA0 && c < 0x100)) return c;
    for (int i = 0; i < 32; i++) if (cp1252_high[i] == c) return i + 0x80;
    return -1;
}

static uint8_t cp1252_case(uint8_t c, int upper) {
    if (upper) {
        if ((c >= 'a' && c <= 'z') || (c >= 0xE0 && c <= 0xFE && c != 0xF7)) return c - 32;
        if (c == 0x9A || c == 0x9C || c == 0x9E) return c - 16;
        return c == 0xFF ? 0x9F : c;
    }
    if ((c >= 'A' && c <= 'Z') || (c >= 0xC0 && c <= 0xDE && c != 0xD7)) return c + 32;
    if (c == 0x8A || c == 0x8C || c == 0x8E) return c + 16;
    return c == 0x9F ? 0xFF : c;
}

static uint16_t cp1252_type(uint8_t c) {
    uint16_t t = 0;
    if (c < 0x20 || c == 0x7F) t |= 0x20; /* control */
    if (c == ' ' || c == '\t') t |= 0x40; /* blank */
    if ((c >= 9 && c <= 13) || c == ' ') t |= 8; /* space */
    if (c >= '0' && c <= '9') t |= 4 | 0x80;
    if ((c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) t |= 0x80;
    if ((c >= 'A' && c <= 'Z') || (c >= 0xC0 && c <= 0xDE && c != 0xD7) ||
        c == 0x8A || c == 0x8C || c == 0x8E || c == 0x9F) t |= 1 | 0x100;
    else if ((c >= 'a' && c <= 'z') || (c >= 0xDF && c != 0xF7) ||
        c == 0x9A || c == 0x9C || c == 0x9E || c == 0x83 ||
        c == 0xAA || c == 0xB5 || c == 0xBA) t |= 2 | 0x100;
    else if (c > 0x20 && c != 0x7F && !(t & 4) && c != 0x81 &&
        c != 0x8D && c != 0x8F && c != 0x90 && c != 0x9D) t |= 0x10;
    if (c == 0xA0) t = 8 | 0x40;
    return t;
}
#endif
