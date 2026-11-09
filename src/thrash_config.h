/* Verok OpenGL3 options: DLL-adjacent [THRASH] keys, then the environment
 * populated by the game's thrash.ini [ENV] loader (native 10009740). */
#ifndef NFS5_THRASH_CONFIG_H
#define NFS5_THRASH_CONFIG_H
#include <ctype.h>
#include <stdlib.h>
static int thrash_configuration_loaded;
static int thrash_environment_loaded;
static uint32_t thrash_texture_filter;
static float thrash_gamma_factor=1;
static int thrash_environment_value(const char *name,char value[12]) {
    uint16_t key[128];unsigned n=0;
    while(name[n]&&n<127){key[n]=cp1252_decode((uint8_t)name[n]);n++;}key[n]=0;
    for(unsigned i=0;i<64;i++)if(process_environment[i].name[0]&&!env_compare(process_environment[i].name,key)){
        const uint16_t *source=process_environment[i].value;
        if(!source[0])return 0;
        /* The native lookup uses a 12-byte buffer. Avoid using undefined
         * stack contents for an environment value that does not fit it. */
        if(env_length(source)>11)return 0;
        for(n=0;source[n];n++)value[n]=source[n]<128?(char)source[n]:'?';
        value[n]=0;return 1;
    }
    return 0;
}
static void thrash_environment_store(const char *name,const char *value) {
    uint16_t key[128];unsigned n=0,slot=64;
    while(name[n]&&n<127){key[n]=cp1252_decode((uint8_t)name[n]);n++;}key[n]=0;
    for(unsigned i=0;i<64;i++)if(process_environment[i].name[0]&&!env_compare(process_environment[i].name,key)){slot=i;break;}
    if(slot==64)for(unsigned i=0;i<64;i++)if(!process_environment[i].name[0]){slot=i;break;}
    if(slot==64)return;
    memcpy(process_environment[slot].name,key,(n+1)*2);
    for(n=0;value[n];n++)process_environment[slot].value[n]=cp1252_decode((uint8_t)value[n]);
    process_environment[slot].value[n]=0;
}
static char *thrash_trim(char *text) {
    while(*text&&isspace((unsigned char)*text))text++;
    char *end=text+strlen(text);while(end>text&&isspace((unsigned char)end[-1]))*--end=0;
    return text;
}
static int thrash_ini_value(char *text,const char *section_name,const char *name,char *value,size_t capacity) {
    int section=0;
    for(char *line=text;line&&*line;){
        char *next=strchr(line,'\n');if(next)*next++=0;
        char *at=thrash_trim(line);
        if(*at=='['){char *end=strchr(++at,']');section=0;if(end){*end=0;section=!strcasecmp(thrash_trim(at),section_name);}}
        else if(section&&*at&&*at!=';'){
            char *pair=strchr(at,'=');
            if(pair){*pair++=0;if(!strcasecmp(thrash_trim(at),name)){
                pair=thrash_trim(pair);size_t n=strlen(pair);
                if(n>=2&&(pair[0]=='"'||pair[0]=='\'')&&pair[n-1]==pair[0]){pair++;n-=2;}
                if(n>=capacity)n=capacity-1;memcpy(value,pair,n);value[n]=0;return n!=0;
            }}
        }
        line=next;
    }
    return 0;
}
static char *thrash_read_ini(const char *path) {
    fs_node *node=fs_find(path);if(!node||(node->attributes&16)||node->size>FS_CHUNK)return NULL;
    char *source=malloc((size_t)node->size+1);if(!source)return NULL;
    if(!fs_read_node(node,0,node->size,(uint8_t*)source)){free(source);return NULL;}
    size_t length=node->size;source[length]=0;
    if(length>=2&&(uint8_t)source[0]==255&&(uint8_t)source[1]==254){
        length=(length-2)/2;
        for(size_t i=0;i<length;i++){
            uint16_t c=(uint8_t)source[2+i*2]|(uint8_t)source[3+i*2]<<8;
            int byte=cp1252_encode(c);source[i]=byte<0?'?':(char)byte;
        }
        source[length]=0;
    }
    return source;
}
static void thrash_load_environment(void) {
    if(thrash_environment_loaded)return;
    thrash_environment_loaded=1;
    /* nfs5.dll:100022B0..10002879 runs before the original CRT starts.
     * Its selected driver and [ENV] values precede driver option lookup. */
    char driver[50]="dx7z",path[PATH_CAPACITY];
    char *source=thrash_read_ini("C:\\nfs5\\nfs5.ini");
    if(source){char selected[50];if(thrash_ini_value(source,"NFS5","ThrashDriver",selected,sizeof selected))strcpy(driver,selected);free(source);}
    snprintf(path,sizeof path,"C:\\nfs5\\Drivers\\%s\\thrash.ini",driver);
    source=thrash_read_ini(path);if(!source)return;
    int section=0;
    for(char *line=source;line&&*line;){
        char *next=strchr(line,'\n');if(next)*next++=0;
        char *at=thrash_trim(line);
        if(*at=='['){char *end=strchr(++at,']');section=0;if(end){*end=0;section=!strcasecmp(thrash_trim(at),"ENV");}}
        else if(section&&*at&&*at!=';'){
            char *pair=strchr(at,'=');
            if(pair){*pair++=0;char *key=thrash_trim(at);pair=thrash_trim(pair);size_t n=strlen(pair);
                if(n>=2&&(pair[0]=='"'||pair[0]=='\'')&&pair[n-1]==pair[0]){pair++;n-=2;}
                if(n>255)n=255;pair[n]=0;
                if(*key&&strlen(key)<128)thrash_environment_store(key,pair);
            }
        }
        line=next;
    }
    free(source);
}
static uint32_t thrash_option(const char *name,uint32_t fallback) {
    char keys[2][128],value[12];snprintf(keys[0],128,"OGL_%s",name);snprintf(keys[1],128,"THRASH_%s",name);
    char *source=thrash_read_ini("C:\\nfs5\\Drivers\\opengl3\\opengl3z.ini");
    if(source){
        size_t length=strlen(source);char *copy=malloc(length+1);
        if(copy){
            for(unsigned i=0;i<2;i++){
                memcpy(copy,source,length+1);
                if(thrash_ini_value(copy,"THRASH",keys[i],value,sizeof value)){
                    thrash_environment_store(keys[i],value);free(copy);free(source);return (uint32_t)strtol(value,NULL,10);
                }
            }
        }
        free(copy);free(source);
    }
    for(unsigned i=0;i<2;i++)if(thrash_environment_value(keys[i],value))return (uint32_t)strtol(value,NULL,10);
    return fallback;
}
static void thrash_load_configuration(void) {
    if(thrash_configuration_loaded)return;
    thrash_configuration_loaded=1;
    thrash_texture_filter=thrash_option("TEXFILTER",0);
    if(thrash_texture_filter>2)thrash_texture_filter=0;
    /* Native 10002612..1000267B uses unsigned conversion and double
     * arithmetic, then rounds to float before checking the allowed range. */
    thrash_gamma_factor=(float)(thrash_option("GAMMA",5)*0.10000000149011612+0.5);
    if(thrash_gamma_factor<0.5f||thrash_gamma_factor>1.5f)thrash_gamma_factor=1;
}
#endif
