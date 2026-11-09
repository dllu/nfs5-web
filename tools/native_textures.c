/* Read-only Verok OpenGL3 texture metadata snapshot from the reference game.
 * i686-w64-mingw32-gcc -O2 tools/native_textures.c -o build/native-textures.exe
 * Run through native_reference.py -- <exe> <Windows-output-path>. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
static int read_bytes(HANDLE process,uintptr_t at,void *data,SIZE_T size){
 SIZE_T count=0;return ReadProcessMemory(process,(void*)at,data,size,&count)&&count==size;
}
int main(int argc,char **argv){
 if(argc!=2)return 2;
 HWND window=FindWindowA(NULL,"Porsche");DWORD pid=0;
 if(!window||!GetWindowThreadProcessId(window,&pid)){fprintf(stderr,"No Porsche window\n");return 3;}
 HANDLE process=OpenProcess(PROCESS_VM_READ|PROCESS_QUERY_INFORMATION,FALSE,pid);
 if(!process){fprintf(stderr,"OpenProcess: %lu\n",GetLastError());return 4;}
 HANDLE modules=CreateToolhelp32Snapshot(TH32CS_SNAPMODULE|TH32CS_SNAPMODULE32,pid);
 MODULEENTRY32 entry;memset(&entry,0,sizeof entry);entry.dwSize=sizeof entry;uintptr_t base=0;
 if(modules!=INVALID_HANDLE_VALUE){
  if(Module32First(modules,&entry))do{
   if(!_stricmp(entry.szModule,"opengl3z.dll")){base=(uintptr_t)entry.modBaseAddr;break;}
  }while(Module32Next(modules,&entry));
  CloseHandle(modules);
 }
 if(!base){fprintf(stderr,"Native OpenGL3 module not found\n");CloseHandle(process);return 5;}
 uint32_t head,flags,spatial,mip,override;
 if(!read_bytes(process,base+0xd2c4,&head,4)||!read_bytes(process,base+0x2bbac,&flags,4)||
    !read_bytes(process,base+0xc2dc,&spatial,4)||!read_bytes(process,base+0xc2d8,&mip,4)||
    !read_bytes(process,base+0xc17c,&override,4)){fprintf(stderr,"Native state read failed\n");CloseHandle(process);return 6;}
 FILE *file=fopen(argv[1],"wb");if(!file){perror("output");CloseHandle(process);return 7;}
 fprintf(file,"{\"pid\":%lu,\"module\":%lu,\"flags\":%lu,\"spatial\":%lu,\"mip\":%lu,\"override\":%lu,\"textures\":[",
  (unsigned long)pid,(unsigned long)base,(unsigned long)flags,(unsigned long)spatial,(unsigned long)mip,(unsigned long)override);
 uint32_t seen[8192];unsigned count=0,mipmapped=0;int result=0;
 while(head){
  uint32_t object[20];
  if(count==8192){fprintf(stderr,"Texture list exceeds snapshot limit\n");result=8;break;}
  for(unsigned i=0;i<count;i++)if(seen[i]==head){fprintf(stderr,"Texture list cycle\n");result=8;break;}
  if(result)break;
  if(!read_bytes(process,head,object,sizeof object)){fprintf(stderr,"Texture metadata read failed at %08lx\n",(unsigned long)head);result=8;break;}
  seen[count]=head;
  fprintf(file,"%s{\"pointer\":%lu,\"id\":%lu,\"width\":%lu,\"height\":%lu,\"extraMips\":%lu,\"format\":%lu,\"paletteFormat\":%lu}",
   count?",":"",(unsigned long)head,(unsigned long)object[0],(unsigned long)object[1],(unsigned long)object[2],
   (unsigned long)object[4],(unsigned long)object[5],(unsigned long)object[6]);
  count++;mipmapped+=object[4]!=0;head=object[19];
 }
 fprintf(file,"],\"complete\":%s}\n",result?"false":"true");
 if(fclose(file))result=9;
 fprintf(stderr,"Native textures: %u allocated, %u mipmapped; raw mip filter %lu, override %lu\n",count,mipmapped,(unsigned long)mip,(unsigned long)override);
 CloseHandle(process);return result;
}
