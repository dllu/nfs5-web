/* Read-only snapshot of the running native Porsche process in this Wine prefix.
 * Build: i686-w64-mingw32-gcc -O2 tools/native_memory.c -o build/native-memory.exe
 * Run through native_reference.py -- <exe> <address> <length> <Windows output path>.
 * Prefix address with @ to read the 32-bit pointer stored at that address first.
 * Code sections are stable after patching; live data is not an atomic snapshot. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
int main(int argc,char **argv){
 if(argc!=4){fprintf(stderr,"Usage: native-memory.exe address|@pointer-address length Windows-output-path\n");return 2;}
 HWND window=FindWindowA(NULL,"Porsche");DWORD pid=0;
 if(!window||!GetWindowThreadProcessId(window,&pid)){fprintf(stderr,"No Porsche window\n");return 3;}
 HANDLE process=OpenProcess(PROCESS_VM_READ|PROCESS_QUERY_INFORMATION,FALSE,pid);
 if(!process){fprintf(stderr,"OpenProcess: %lu\n",GetLastError());return 4;}
 int indirect=argv[1][0]=='@';
 uintptr_t address=strtoul(argv[1]+indirect,NULL,0);SIZE_T length=strtoul(argv[2],NULL,0),read=0;
 if(indirect){
  uint32_t target=0;
  if(!ReadProcessMemory(process,(void*)address,&target,sizeof target,&read)||read!=sizeof target){fprintf(stderr,"ReadProcessMemory pointer: %lu\n",GetLastError());CloseHandle(process);return 5;}
  if(!target){fprintf(stderr,"Null pointer at %08lx\n",(unsigned long)address);CloseHandle(process);return 5;}
  address=target;
 }
 void *bytes=malloc(length);
 if(!bytes||!ReadProcessMemory(process,(void*)address,bytes,length,&read)||read!=length){fprintf(stderr,"ReadProcessMemory: %lu, %lu/%lu\n",GetLastError(),(unsigned long)read,(unsigned long)length);return 5;}
 FILE *f=fopen(argv[3],"wb");if(!f){perror("fopen");return 6;}
 if(fwrite(bytes,1,length,f)!=length||fclose(f)){perror("output");return 7;}
 fprintf(stderr,"Read %lu bytes at %08lx from native process %lu\n",(unsigned long)length,(unsigned long)address,pid);free(bytes);CloseHandle(process);return 0;
}

