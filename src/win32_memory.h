/* Protection metadata and reservation ownership. The flat Wasm memory cannot
 * trap stores to read-only guest pages; API validation still observes their
 * committed state, protection changes and allocation boundaries. */
#ifndef NFS5_WIN32_MEMORY_H
#define NFS5_WIN32_MEMORY_H
static uint8_t memory_protection[GUEST_SIZE/MAP_PAGE];
static uint32_t memory_owner[GUEST_SIZE/MAP_PAGE];
static void memory_claim(uint32_t address,uint32_t size,uint32_t protection,uint32_t owner) {
    uint32_t end=(address+size+MAP_PAGE-1)/MAP_PAGE;
    for(uint32_t i=address/MAP_PAGE;i<end;i++){memory_protection[i]=protection;memory_owner[i]=owner;}
}
static void memory_reset(void) {
    memset(memory_protection,0,sizeof memory_protection);memset(memory_owner,0,sizeof memory_owner);
    memory_claim(0x10000,0x1000000-0x10000,4,2);
    for(unsigned i=0;i<8;i++)memory_claim(HEAP_LIMIT+i*0x400000,0x400000,4,3+i);
}
static int memory_protection_valid(uint32_t value) { return value==1||value==2||value==4||value==0x10||value==0x20||value==0x40; }
static int memory_import(const char *name) {
    if(!strcmp(name,"VirtualProtect")) {
        uint32_t address=argument(0),size=argument(1),protection=argument(2),output=argument(3),old=0;
        if(!size||!output||!web_guest_range(output,4)||!memory_protection_valid(protection)){last_error=87;result(0,4);return 1;}
        if((address&0xE0000000u)==MAP_VM_BASE) {
            int ok=mapping_protect(address,size,protection,&old);if(ok)MEM32(output)=old;result(ok,4);return 1;
        }
        if(!web_guest_range(address,size)){last_error=487;result(0,4);return 1;}
        uint32_t first=address/MAP_PAGE,end=(address+size+MAP_PAGE-1)/MAP_PAGE,owner=memory_owner[first];old=memory_protection[first];
        for(uint32_t i=first;i<end;i++)if(!owner||memory_owner[i]!=owner||!memory_protection[i]){last_error=487;result(0,4);return 1;}
        for(uint32_t i=first;i<end;i++)memory_protection[i]=protection;
        MEM32(output)=old;result(1,4);return 1;
    }
    if(!strcmp(name,"VirtualAlloc")) {
        uint32_t address=argument(0),size=argument(1),flags=argument(2),protection=argument(3);
        if(!size||!memory_protection_valid(protection)||!(flags&0x3000)||(flags&~0x3000u)){last_error=87;result(0,4);return 1;}
        if(address) {
            uint64_t end=((uint64_t)address+size+MAP_PAGE-1)&~(uint64_t)(MAP_PAGE-1);
            address&=~(MAP_PAGE-1);guest_block *block=NULL;
            for(unsigned i=0;i<block_count;i++)if(blocks[i].live&&blocks[i].kind==2&&address>=blocks[i].address&&address<blocks[i].address+blocks[i].span)block=blocks+i;
            if(end>GUEST_SIZE||end<=address||!block||end>block->address+block->span){last_error=487;result(0,4);return 1;}
            uint32_t rounded=(uint32_t)end-address;
            if(flags&0x1000) {
                for(uint32_t i=address/MAP_PAGE;i<(address+rounded)/MAP_PAGE;i++)if(!memory_protection[i]){memset((void*)ADDR(i*MAP_PAGE),0,MAP_PAGE);memory_protection[i]=protection;}
            }
            result(address,4);return 1;
        }
        if(size>HEAP_LIMIT-MAP_PAGE){last_error=8;result(0,4);return 1;}
        address=allocate_kind(size,65536,2);guest_block *block=find_block(address,2);
        memory_claim(address,block->span,flags&0x1000?protection:0,address);result(address,4);return 1;
    }
    if(!strcmp(name,"VirtualFree")) {
        uint32_t address=argument(0),size=argument(1),flags=argument(2);guest_block *block=find_block(address,2);
        if(flags==0x8000&&!size&&block){release_block(block);result(1,3);return 1;}
        if(flags==0x4000) {
            uint32_t aligned=address&~(MAP_PAGE-1);
            for(unsigned i=0;i<block_count;i++)if(blocks[i].live&&blocks[i].kind==2&&aligned>=blocks[i].address&&aligned<blocks[i].address+blocks[i].span) {
                block=blocks+i;uint64_t end=(uint64_t)address+size+MAP_PAGE-1;end&=~(uint64_t)(MAP_PAGE-1);
                if(!size&&address!=block->address)break;
                if(!size&&address==block->address)end=block->address+block->span;
                if(end>block->address+block->span||end<aligned)break;
                memory_claim(aligned,(uint32_t)end-aligned,0,block->address);memset((void*)ADDR(aligned),0,(uint32_t)end-aligned);result(1,3);return 1;
            }
        }
        last_error=87;result(0,3);return 1;
    }
    return 0;
}
#endif
