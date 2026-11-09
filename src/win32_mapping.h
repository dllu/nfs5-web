/* File views have distinct guest VAs and shared native backing. Translation is
 * applied to lifted accesses and host pointers, so overlapping writable views
 * observe the same bytes without copying on every CPU access. */
#ifndef NFS5_WIN32_MAPPING_H
#define NFS5_WIN32_MAPPING_H
#define MAP_LIMIT (128u<<20)
typedef struct { uint32_t refs,node,size,capacity;uint8_t *data,*shadow; } map_storage;
typedef struct { uint32_t refs,storage,size,protection,file;char name[260]; } map_object;
typedef struct { uint32_t generation,object,access; } map_handle;
typedef struct { uint32_t base,span,size,offset,object,access;uint8_t *copy; } map_view;
static map_storage map_stores[64];
static map_object map_objects[128];
static map_handle map_handles[256];
static map_view map_views[256];
static uint32_t map_allocated;
uintptr_t web_map_pages[MAP_VM_SIZE/MAP_PAGE];
static uint8_t map_protection[MAP_VM_SIZE/MAP_PAGE];
static void mapping_reset(void) {
    for(unsigned i=0;i<64;i++){free(map_stores[i].data);free(map_stores[i].shadow);}
    for(unsigned i=0;i<256;i++)free(map_views[i].copy);
    memset(map_stores,0,sizeof map_stores);memset(map_objects,0,sizeof map_objects);
    memset(map_handles,0,sizeof map_handles);memset(map_views,0,sizeof map_views);
    memset(web_map_pages,0,sizeof web_map_pages);memset(map_protection,0,sizeof map_protection);map_allocated=0;
}
static int mapping_name_exists(const char *name) {
    for(unsigned i=0;i<128;i++)if(map_objects[i].refs&&*map_objects[i].name&&!strcmp(map_objects[i].name,name))return 1;
    return 0;
}
static int mapping_node_active(uint32_t node) {
    for(unsigned i=0;i<64;i++)if(map_stores[i].refs&&map_stores[i].node==node)return 1;
    return 0;
}
static void map_refresh(map_view *v) {
    map_object *o=map_objects+v->object-1;map_storage *s=map_stores+o->storage-1;
    uint8_t *data=v->copy?v->copy:s->data+v->offset;
    for(uint32_t i=0;i<(v->size+MAP_PAGE-1)/MAP_PAGE;i++)web_map_pages[(v->base-MAP_VM_BASE)/MAP_PAGE+i]=(uintptr_t)(data+i*MAP_PAGE);
}
static int map_grow(map_storage *s,uint32_t size) {
    uint32_t capacity=(size+MAP_PAGE-1)&~(MAP_PAGE-1);
    if(size>MAP_LIMIT||capacity>MAP_LIMIT-map_allocated+s->capacity){last_error=8;return 0;}
    if(size<=s->size)return 1;
    uint8_t *data=calloc(capacity,1),*shadow=s->shadow?calloc(capacity,1):NULL;
    if(!data||(s->shadow&&!shadow)){free(data);free(shadow);last_error=8;return 0;}
    if(s->size){memcpy(data,s->data,s->size);if(shadow)memcpy(shadow,s->shadow,s->size);}
    if(s->node && !fs_read_node(fs_nodes+s->node-1,s->size,size-s->size,data+s->size)){free(data);free(shadow);return 0;}
    if(shadow)memcpy(shadow+s->size,data+s->size,size-s->size);
    free(s->data);free(s->shadow);map_allocated+=capacity-s->capacity;s->data=data;s->shadow=shadow;s->capacity=capacity;s->size=size;
    for(unsigned i=0;i<256;i++)if(map_views[i].base&&!map_views[i].copy&&map_objects[map_views[i].object-1].storage==(uint32_t)(s-map_stores)+1)map_refresh(map_views+i);
    return 1;
}
static void map_storage_drop(map_storage *s) {
    if(s->refs)return;
    map_allocated-=s->capacity;free(s->data);free(s->shadow);memset(s,0,sizeof *s);
}
static void map_object_drop(map_object *o) {
    if(--o->refs)return;
    if(o->file)fs_close(o->file);
    map_storage *s=map_stores+o->storage-1;s->refs--;map_storage_drop(s);memset(o,0,sizeof *o);
}
static map_handle *map_get(uint32_t handle) {
    unsigned slot=(handle&0xFFF)/4;
    if((handle&0xFF000003)!=0x79000000||slot>=256||!map_handles[slot].object||map_handles[slot].generation!=((handle>>12)&0xFFF))return NULL;
    return map_handles+slot;
}
static uint32_t map_reference(map_object *o,uint32_t access) {
    for(unsigned i=0;i<256;i++)if(!map_handles[i].object&&map_handles[i].generation<0xFFF) {
        map_handle *h=map_handles+i;h->generation++;h->object=(uint32_t)(o-map_objects)+1;h->access=access;o->refs++;
        return 0x79000000|(h->generation<<12)|i*4;
    }last_error=4;return 0;
}
static int map_flush(map_view *v,uint32_t offset,uint32_t size) {
    map_object *o=map_objects+v->object-1;map_storage *s=map_stores+o->storage-1;
    if(!(v->access&2)||v->copy||!s->node||!size)return 1;
    uint32_t first=v->offset+offset,end=first+size;
    while(first<end&&s->data[first]==s->shadow[first])first++;
    while(end>first&&s->data[end-1]==s->shadow[end-1])end--;
    if(first==end)return 1;
    fs_node *node=fs_nodes+s->node-1;
    if(!fs_resize(node,node->size,1))return 0;
    memcpy(node->data+first,s->data+first,end-first);memcpy(s->shadow+first,s->data+first,end-first);fs_touch(node);fs_uncache(node);return 1;
}
static int mapping_flush_all(void) {
    for(unsigned i=0;i<256;i++)if(map_views[i].base&&!map_flush(map_views+i,0,map_views[i].size))return 0;
    return 1;
}
static int mapping_flush_node(uint32_t node) {
    for(unsigned i=0;i<256;i++)if(map_views[i].base) {
        map_view *v=map_views+i;map_object *o=map_objects+v->object-1;
        if(map_stores[o->storage-1].node==node&&!map_flush(v,0,v->size))return 0;
    }
    return 1;
}
static uint32_t map_access(uint32_t access) {
    if(access==0xF001F)access=6;
    if(!access||(access&~7u)){last_error=87;return 0;}
    return access&2?6:4;
}
static uint32_t map_create(void) {
    uint32_t file=argument(0),protection=argument(2),high=argument(3),size=argument(4),name=argument(5),page=protection&0xFF;
    if(high||size>MAP_LIMIT){last_error=8;return 0;}
    if((page!=2&&page!=4&&page!=8)||(protection&~0x080000FFu)){last_error=50;return 0;}
    const char *label=name?(const char*)ADDR(name):"";
    if(strlen(label)>=260){last_error=206;return 0;}
    if(*label) {
        for(unsigned i=0;i<256;i++)if(sync_objects[i].references&&!strcmp(sync_objects[i].name,label)){last_error=6;return 0;}
        for(unsigned i=0;i<128;i++)if(map_objects[i].refs&&!strcmp(map_objects[i].name,label)) {
            uint32_t handle=map_reference(map_objects+i,map_objects[i].protection==4?6:4);if(handle)last_error=183;return handle;
        }
    }
    fs_object *f=file==0xFFFFFFFF?NULL:fs_get(file);fs_node *node=f?fs_nodes+f->node-1:NULL;
    if(file!=0xFFFFFFFF&&!f){last_error=6;return 0;}
    if(f&&(!(f->access&1)||(page==4&&!(f->access&2)))){last_error=5;return 0;}
    if(!size)size=node?node->size:0;
    if(!size){last_error=1006;return 0;}
    if(size>MAP_LIMIT){last_error=8;return 0;}
    if(node&&size>node->size){if(page!=4){last_error=5;return 0;}if(!fs_resize(node,size,1))return 0;}
    map_object *o=NULL;for(unsigned i=0;i<128;i++)if(!map_objects[i].refs){o=map_objects+i;break;}
    if(!o){last_error=4;return 0;}
    map_storage *s=NULL;
    if(f)for(unsigned i=0;i<64;i++)if(map_stores[i].data&&map_stores[i].node==f->node){s=map_stores+i;break;}
    if(!s)for(unsigned i=0;i<64;i++)if(!map_stores[i].data){s=map_stores+i;s->node=f?f->node:0;break;}
    if(!s){last_error=8;return 0;}
    if(!map_grow(s,size)){map_storage_drop(s);return 0;}
    uint32_t copy=f?fs_reference((uint32_t)(f-fs_objects)):0;
    if(f&&!copy){map_storage_drop(s);return 0;}
    *o=(map_object){.refs=1,.storage=(uint32_t)(s-map_stores)+1,.size=size,.protection=page,.file=copy};strcpy(o->name,label);s->refs++;
    uint32_t handle=map_reference(o,page==4?6:4);map_object_drop(o);if(handle)last_error=0;return handle;
}
static uint32_t map_view_create(void) {
    map_handle *h=map_get(argument(0));if(!h){last_error=6;return 0;}
    uint32_t access=argument(1),wanted=map_access(access),high=argument(2),offset=argument(3),size=argument(4);
    if(!wanted)return 0;
    if((h->access&wanted)!=wanted){last_error=5;return 0;}
    if(high){last_error=87;return 0;}
    if(offset&65535){last_error=1132;return 0;}
    map_object *o=map_objects+h->object-1;map_storage *s=map_stores+o->storage-1;
    if(!size&&offset<o->size)size=o->size-offset;
    if(offset>=o->size||!size||size>o->size-offset){last_error=87;return 0;}
    map_view *v=NULL;for(unsigned i=0;i<256;i++)if(!map_views[i].base){v=map_views+i;break;}
    if(!v){last_error=8;return 0;}
    uint32_t span=(size+65535)&~65535u,base=MAP_VM_BASE;
    for(;;) {
        uint32_t next=base;
        for(unsigned i=0;i<256;i++)if(map_views[i].base&&base<map_views[i].base+map_views[i].span&&map_views[i].base<base+span)next=map_views[i].base+map_views[i].span;
        if(next==base)break;base=next;
        if(base>MAP_VM_BASE+MAP_VM_SIZE-span){last_error=8;return 0;}
    }
    uint8_t *copy=NULL;uint32_t capacity=(size+MAP_PAGE-1)&~(MAP_PAGE-1);
    if((access&1)&&!(access&2)) {
        if(capacity>MAP_LIMIT-map_allocated){last_error=8;return 0;}
        copy=calloc(capacity,1);if(!copy){last_error=8;return 0;}memcpy(copy,s->data+offset,size);map_allocated+=capacity;
    }else if((access&2)&&s->node&&!s->shadow) {
        s->shadow=malloc(s->capacity);if(!s->shadow){last_error=8;return 0;}memcpy(s->shadow,s->data,s->capacity);
    }
    *v=(map_view){base,span,size,offset,h->object,access==0xF001F?6:access,copy};o->refs++;map_refresh(v);
    memset(map_protection+(base-MAP_VM_BASE)/MAP_PAGE,copy?8:v->access&2?4:2,(size+MAP_PAGE-1)/MAP_PAGE);return base;
}
int web_guest_range(uint32_t address,uint32_t size) {
    if(address<WEB_GUEST_SIZE)return size<=WEB_GUEST_SIZE-address;
    if((address&0xE0000000u)!=MAP_VM_BASE)return 0;
    for(unsigned i=0;i<256;i++)if(map_views[i].base&&address>=map_views[i].base) {
        uint32_t offset=address-map_views[i].base,capacity=(map_views[i].size+MAP_PAGE-1)&~(MAP_PAGE-1);
        if(offset<capacity&&size<=capacity-offset)return 1;
    }return 0;
}
static int mapping_protect(uint32_t address,uint32_t size,uint32_t protection,uint32_t *old) {
    if(!web_guest_range(address,size)){last_error=487;return 0;}
    map_view *v=NULL;for(unsigned i=0;i<256;i++)if(map_views[i].base&&address>=map_views[i].base&&address-map_views[i].base<map_views[i].span){v=map_views+i;break;}
    if(!v){last_error=487;return 0;}
    if(protection>=0x10||(protection==4&&!(v->access&2)&&!v->copy)){last_error=5;return 0;}
    uint32_t first=(address-MAP_VM_BASE)/MAP_PAGE,end=(address-MAP_VM_BASE+size+MAP_PAGE-1)/MAP_PAGE;*old=map_protection[first];
    memset(map_protection+first,protection,end-first);return 1;
}
static void map_flush_import(void) {
    uint32_t address=argument(0),size=argument(1);
    for(unsigned i=0;i<256;i++)if(map_views[i].base&&address>=map_views[i].base&&address-map_views[i].base<map_views[i].size) {
        map_view *v=map_views+i;uint32_t offset=address-v->base;if(!size)size=v->size-offset;
        if(size>v->size-offset){last_error=87;result(0,2);return;}
        result(map_flush(v,offset,size),2);return;
    }last_error=487;result(0,2);
}
static int mapping_import(const char *name) {
    if(!strcmp(name,"CreateFileMappingA")){uint32_t handle=map_create();result(handle,6);return 1;}
    if(!strcmp(name,"MapViewOfFile")){uint32_t base=map_view_create();result(base,5);return 1;}
    if(!strcmp(name,"OpenFileMappingA")) {
        uint32_t name=argument(2),access=map_access(argument(0));if(!name||!access){if(!name)last_error=87;result(0,3);return 1;}
        for(unsigned i=0;i<128;i++)if(map_objects[i].refs&&*map_objects[i].name&&!strcmp(map_objects[i].name,(const char*)ADDR(name))) {
            if((access&2)&&map_objects[i].protection!=4){last_error=5;result(0,3);return 1;}
            result(map_reference(map_objects+i,access),3);return 1;
        }last_error=2;result(0,3);return 1;
    }
    if(!strcmp(name,"UnmapViewOfFile")) {
        for(unsigned i=0;i<256;i++)if(map_views[i].base&&map_views[i].base==argument(0)) {
            map_view *v=map_views+i;if(!map_flush(v,0,v->size)){result(0,1);return 1;}
            for(unsigned j=0;j<(v->size+MAP_PAGE-1)/MAP_PAGE;j++){web_map_pages[(v->base-MAP_VM_BASE)/MAP_PAGE+j]=0;map_protection[(v->base-MAP_VM_BASE)/MAP_PAGE+j]=0;}
            if(v->copy){free(v->copy);map_allocated-=(v->size+MAP_PAGE-1)&~(MAP_PAGE-1);}
            map_object_drop(map_objects+v->object-1);memset(v,0,sizeof *v);result(1,1);return 1;
        }last_error=487;result(0,1);return 1;
    }
    if(!strcmp(name,"CloseHandle")&&(argument(0)&0xFF000000)==0x79000000) {
        map_handle *h=map_get(argument(0));if(!h){last_error=6;result(0,1);return 1;}
        map_object *o=map_objects+h->object-1;h->object=0;map_object_drop(o);result(1,1);return 1;
    }
    if(!strcmp(name,"DuplicateHandle")&&(argument(1)&0xFF000000)==0x79000000) {
        map_handle *h=map_get(argument(1));
        if(!h||argument(0)!=0xFFFFFFFF||argument(2)!=0xFFFFFFFF||!argument(3)){last_error=6;result(0,7);return 1;}
        uint32_t access=argument(6)&2?h->access:map_access(argument(4));
        if(!access||(access&h->access)!=access){last_error=5;result(0,7);return 1;}
        uint32_t copy=map_reference(map_objects+h->object-1,access);
        if(copy){MEM32(argument(3))=copy;if(argument(6)&1){map_object *o=map_objects+h->object-1;h->object=0;map_object_drop(o);}}
        result(copy!=0,7);return 1;
    }
    return 0;
}
#endif
