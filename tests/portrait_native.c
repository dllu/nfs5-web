/* Optional native oracle; run only through tools/native_reference.py.
 * i686-w64-mingw32-gcc -O2 tests/portrait_native.c -o build/portrait-native.exe */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    if (argc != 4) return 2;
    HMODULE module = LoadLibraryA("gimme.dll");
    if (!module) { fprintf(stderr, "LoadLibrary: %lu\n", GetLastError()); return 3; }
    typedef unsigned char (__cdecl *convert_fn)(const char *, const char *, int);
    convert_fn convert = (convert_fn)GetProcAddress(module, "ConvertFile");
    if (!convert) return 4;
    unsigned result = convert(argv[1], argv[2], atoi(argv[3]));
    printf("ConvertFile returned %u\n", result);
    FreeLibrary(module);
    return result ? 0 : 5;
}
