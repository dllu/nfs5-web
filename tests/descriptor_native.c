/* Optional native capability oracle; run through tools/native_reference.py.
 * i686-w64-mingw32-gcc -O2 tests/descriptor_native.c -o build/descriptor-native.exe */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
int main(int argc,char **argv){
 if(argc!=2)return 2;
 const char *ini=".\\Drivers\\opengl3\\thrash.ini";
 char keys[1024],value[256];
 GetPrivateProfileStringA("ENV",NULL,"",keys,sizeof keys,ini);
 for(char *key=keys;*key;key+=strlen(key)+1){
  GetPrivateProfileStringA("ENV",key,"",value,sizeof value,ini);
  SetEnvironmentVariableA(key,value);
 }
 HMODULE module=LoadLibraryA(".\\Drivers\\opengl3\\opengl3z.dll");
 if(!module){fprintf(stderr,"LoadLibrary: %lu\n",GetLastError());return 3;}
 typedef uint32_t *(__stdcall *about_fn)(void);
 about_fn about=(about_fn)GetProcAddress(module,"_THRASH_about@0");
 if(!about)return 4;
 const uint32_t *d=about();if(!d)return 5;
 FILE *file=fopen(argv[1],"wb");if(!file)return 6;
 fprintf(file,"{\"words\":[");
 for(unsigned i=0;i<d[1]/4;i++)fprintf(file,"%s%lu",i?",":"",(unsigned long)d[i]);
 fprintf(file,"],\"formats\":[");
 const uint32_t *formats=(const uint32_t*)(uintptr_t)d[12];
 for(unsigned i=0;i<d[11];i++)fprintf(file,"%s%lu",i?",":"",(unsigned long)formats[i]);
 fprintf(file,"],\"name\":\"%.39s\"}\n",(const char*)d+0x4c);
 if(fclose(file))return 7;
 printf("Native descriptor: signature=%08lx size=%lu flags=%02lx subtype=%lu stages=%lu\n",
  (unsigned long)d[0],(unsigned long)d[1],(unsigned long)d[3],(unsigned long)d[27],(unsigned long)d[17]);
 FreeLibrary(module);return 0;
}
