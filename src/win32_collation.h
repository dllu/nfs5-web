/* Linguistic CP1252 comparison uses the browser/Node ICU collator. It is an
 * en-US approximation of Windows NLS, not a Windows 9x sort-table replica. */
#ifndef NFS5_WIN32_COLLATION_H
#define NFS5_WIN32_COLLATION_H
EM_JS(int, locale_compare, (const uint8_t *left, uint32_t left_size, const uint8_t *right, uint32_t right_size, uint32_t flags), {
    var decode = new TextDecoder('windows-1252');
    var a = decode.decode(Uint8Array.from(HEAPU8.subarray(left, left + left_size)));
    var b = decode.decode(Uint8Array.from(HEAPU8.subarray(right, right + right_size)));
    var sensitivity = flags & 1 ? flags & 2 ? 'base' : 'accent' : flags & 2 ? 'case' : 'variant';
    var collator = new Intl.Collator('en-US', { sensitivity, caseFirst: 'lower', ignorePunctuation: Boolean(flags & 4) });
    if (flags & 4) {
        // CP1252 symbol characters that ignorePunctuation does not cover.
        var symbols = new RegExp('[$+<=>^`|~\u00a2-\u00a6\u00a8-\u00a9\u00ac\u00ae-\u00b1\u00b4\u00b6\u00b8\u00d7\u00f7\u20ac\u2122]', 'g');
        a = a.replace(symbols, ""); b = b.replace(symbols, "");
    }
    var compared;
    if (!(flags & 0x1000) && !(flags & 4)) {
        var punctuation = new RegExp("[-']", 'g');
        compared = collator.compare(a.replace(punctuation, ""), b.replace(punctuation, ""));
        if (!compared) compared = collator.compare(a, b);
    } else compared = collator.compare(a, b);
    return compared < 0 ? 1 : compared > 0 ? 3 : 2;
});
static int collation_import(const char *name) {
    if (strcmp(name, "CompareStringA")) return 0;
    uint32_t locale = argument(0), flags = argument(1), left = argument(2), right = argument(4);
    if (locale != 0 && locale != 0x409 && locale != 0x400 && locale != 0x800) { last_error = 87; result(0, 6); return 1; }
    if (flags & ~0x31007u) { last_error = 1004; result(0, 6); return 1; }
    if (!left || !right) { last_error = 87; result(0, 6); return 1; }
    int32_t left_size = (int32_t)argument(3), right_size = (int32_t)argument(5);
    if (left_size < 0) left_size = (int32_t)strlen((const char *)ADDR(left));
    if (right_size < 0) right_size = (int32_t)strlen((const char *)ADDR(right));
    result(locale_compare((const uint8_t *)ADDR(left), (uint32_t)left_size, (const uint8_t *)ADDR(right), (uint32_t)right_size, flags), 6); return 1;
}
#endif
