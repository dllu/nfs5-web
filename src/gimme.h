/* Built-in FaceInRace portraits: the supplied GIMME converter expands the
 * atlas's indexed RGB565 images to 54x64 RGB565 FSH images. Native pixel
 * comparisons cover all nine atlas frames. Custom photo codecs/resizing
 * remain unsupported; reject those without replacing an existing image. */
#ifndef NFS5_GIMME_H
#define NFS5_GIMME_H
#define GIMME_MODULE 0x7B000001u
#define GIMME_CONVERT 0xF7000000u
static uint32_t gimme_word(const uint8_t *p) { return p[0] | (uint32_t)p[1] << 8; }
static uint32_t gimme_dword(const uint8_t *p) { return gimme_word(p) | gimme_word(p+2) << 16; }
static void gimme_put(uint8_t *p,uint32_t value) { for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(value>>(i*8)); }
static uint32_t gimme_module(const char *name) {
    if(!name)return 0;
    const char *base=name;
    for(const char *p=name;*p;p++)if(*p=='/'||*p=='\\')base=p+1;
    return dll_equal(base,strlen(base),"gimme",5)?GIMME_MODULE:0;
}
static void gimme_convert(void) {
    char source_path[PATH_CAPACITY],destination_path[PATH_CAPACITY];
    uint32_t frame=argument(2);
    if(!argument(0)||!argument(1)){last_error=87;result(0,0);return;}
    if(!fs_resolve(argument(0),source_path)||!fs_resolve(argument(1),destination_path)){result(0,0);return;}
    fs_node *source=fs_find(source_path),*destination=fs_find(destination_path);
    if(!source){last_error=2;result(0,0);return;}
    if(source->attributes&16){last_error=5;result(0,0);return;}
    if(!fs_shares(source,1,7)||!mapping_flush_node((uint32_t)(source-fs_nodes)+1)){result(0,0);return;}
    if(source->size<16||source->size>FS_WRITE_LIMIT){last_error=13;result(0,0);return;}
    uint8_t *input=malloc(source->size);
    if(!input){last_error=8;result(0,0);return;}
    if(!fs_read_node(source,0,source->size,input)){free(input);result(0,0);return;}
    uint32_t count=gimme_dword(input+8),size=gimme_dword(input+4),offset=0;
    int valid=!memcmp(input,"SHPI",4)&&size<=source->size&&size>=16&&count<=(size-16)/8&&frame<count;
    if(valid){offset=gimme_dword(input+20+frame*8);valid=offset>=16+count*8&&offset<=size&&size-offset>=16;}
    uint32_t width=0,height=0,format=0,palette=0;
    if(valid){
        width=gimme_word(input+offset+4);height=gimme_word(input+offset+6);format=input[offset];
        valid=width==54&&height==64;
        if(valid&&format==0x7b){
            uint32_t next=gimme_dword(input+offset)>>8;
            valid=next>=16+54*64&&next<=size-offset&&size-offset-next>=16+256*2;
            if(valid){palette=offset+next;valid=input[palette]==0x29&&gimme_word(input+palette+4)==256;}
        }else if(valid&&format==0x78)valid=size-offset>=16+54*64*2;
        else valid=0;
    }
    if(!valid){free(input);last_error=50;result(0,0);return;}
    /* Emit a single-image FSH with the native RGB565 pixel plane. The game's
     * portrait loader accepts it without the native writer's trailing bytes. */
    enum { OUTPUT_SIZE=32+16+54*64*2 };
    uint8_t *output=calloc(OUTPUT_SIZE,1);
    if(!output){free(input);last_error=8;result(0,0);return;}
    memcpy(output,"SHPI",4);gimme_put(output+4,OUTPUT_SIZE);gimme_put(output+8,1);
    memcpy(output+12,"GIMX",4);memcpy(output+16,input+16+frame*8,4);gimme_put(output+20,32);
    memcpy(output+24,"Buy ERTS",8);output[32]=0x78;output[36]=54;output[38]=64;
    if(format==0x78)memcpy(output+48,input+offset+16,54*64*2);
    else for(unsigned i=0;i<54*64;i++)memcpy(output+48+i*2,input+palette+16+input[offset+16+i]*2,2);
    free(input);
    int ok=0;
    if(destination_path[0]=='D')last_error=19;
    else if(destination&&(destination->attributes&17))last_error=5;
    else if(!destination&&!fs_parent(destination_path)){}
    else if(destination&&!fs_shares(destination,2,3)){}
    else if(destination&&mapping_node_active((uint32_t)(destination-fs_nodes)+1))last_error=1224;
    else {
        if(!destination)destination=fs_new(destination_path,32);
        if(destination&&fs_resize(destination,OUTPUT_SIZE,0)){
            memcpy(destination->data,output,OUTPUT_SIZE);fs_uncache(destination);last_error=0;ok=1;
        }
    }
    free(output);
    /* ConvertFile is cdecl; the original caller removes its three arguments. */
    result(ok,0);
}
#endif
