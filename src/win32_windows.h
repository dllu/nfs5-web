/* Desktop identity, device-context lifetimes and logical display geometry. */
#ifndef NFS5_WIN32_WINDOWS_H
#define NFS5_WIN32_WINDOWS_H
#define WIN_DESKTOP 0x74000001u
typedef struct {
    uint32_t handle, generation, owner, procedure, atom, instance, parent, menu, style, extended, user, extra, extra_size;
    int32_t x, y, width, height, left, top, right, bottom;
    uint32_t visible, iconic, destroying, paint, dc_refs;
    char title[260];
} guest_window;
static guest_window win_windows[64];
static uint32_t win_viewport_width=1920,win_viewport_height=1080;
static uint32_t win_foreground, win_focus;
static int32_t win_cursor_count;
static uint32_t win_cursor;
typedef struct {
    uint32_t atom,style,procedure,instance,extra,cursor,background;
    char name[256];
} guest_class;
typedef struct { uint32_t owner,notify,hwnd,message,wparam,lparam,time,x,y; } guest_message;
static guest_class win_classes[64];
static guest_message win_messages[1024];
static uint32_t win_message_count,win_next_atom;

static guest_window *win_get(uint32_t handle) {
    for (unsigned i = 0; i < 64; i++) if (win_windows[i].handle && win_windows[i].handle == handle) return &win_windows[i];
    return NULL;
}
static void win_origin(guest_window *w,int32_t *x,int32_t *y) {
    *x=*y=0;
    for(unsigned i=0;i<64&&w;i++) {
        *x+=w->x+w->left;*y+=w->y+w->top;
        w=(w->style&0x40000000)?win_get(w->parent):NULL;
    }
}
static void win_reset(void) {
    win_viewport_width=1920;win_viewport_height=1080;
    memset(win_windows, 0, sizeof win_windows);
    win_windows[0] = (guest_window){.handle = WIN_DESKTOP, .style = 0x90000000, .width = 1920, .height = 1080, .visible = 1};
    strcpy(win_windows[0].title, "Desktop"); win_foreground = win_focus = 0;
    win_cursor_count = 0; win_cursor = 0x76007F00;
    memset(win_classes,0,sizeof win_classes);win_next_atom=0xC000;win_message_count=0;
}
static guest_class *win_class(uint32_t name,uint32_t instance) {
    for(unsigned i=0;i<64;i++) {
        guest_class *c=win_classes+i;
        if(c->atom && (!instance || c->instance==instance || (c->style&0x4000)) &&
           (name<0x10000?name==c->atom:!strcasecmp((const char*)ADDR(name),c->name)))return c;
    }return NULL;
}
static void win_insets(uint32_t style,uint32_t extended,int menu,int32_t *left,int32_t *top,int32_t *right,int32_t *bottom) {
    int border=style&0x40000?8:style&0x800000?1:style&0x400000?3:0;
    if(extended&0x200)border+=2;
    *left=*right=*bottom=border;*top=border+((style&0xC00000)==0xC00000?23:0)+(menu?19:0);
    if(style&0x200000)*right+=17;if(style&0x100000)*bottom+=17;
}
static int win_enqueue(uint32_t owner,uint32_t hwnd,uint32_t message,uint32_t wparam,uint32_t lparam,uint32_t notify) {
    if(message==0x200 && win_message_count) {
        guest_message *last=win_messages+win_message_count-1;
        if(last->message==message&&last->hwnd==hwnd&&last->owner==owner&&!last->notify&&!notify){
            last->wparam=wparam;last->lparam=lparam;last->time=win_ticks();last->x=di_cursor[0];last->y=di_cursor[1];return 1;
        }
    }
    if(win_message_count==1024){last_error=1816;return 0;}
    win_messages[win_message_count++]=(guest_message){owner,notify,hwnd,message,wparam,lparam,win_ticks(),di_cursor[0],di_cursor[1]};
    return 1;
}
static int win_post(uint32_t hwnd,uint32_t message,uint32_t wparam,uint32_t lparam,uint32_t notify) {
    if(hwnd==0xFFFF) {
        int ok=1;for(unsigned i=1;i<64;i++)if(win_windows[i].handle && !(win_windows[i].style&0x40000000))
            ok&=win_enqueue(win_windows[i].owner,win_windows[i].handle,message,wparam,lparam,notify);
        return ok;
    }
    guest_window *w=win_get(hwnd);
    if(hwnd && !w){last_error=1400;return 0;}
    return win_enqueue(w?w->owner:guest_tid(),hwnd,message,wparam,lparam,notify);
}
static uint32_t win_send(guest_window *w,uint32_t message,uint32_t wp,uint32_t lp) {
    if(w->owner!=guest_tid()){win_post(w->handle,message,wp,lp,1);return 0;}
    uint32_t args[]={w->handle,message,wp,lp};return guest_callback(w->procedure,4,args);
}
static void win_free_window(guest_window *w) {
    uint32_t handle=w->handle,generation=w->generation;
    if(w->extra){guest_block *block=find_block(w->extra,1);if(block)release_block(block);}
    for(unsigned i=0;i<win_message_count;) {
        if(win_messages[i].hwnd==handle) {memmove(win_messages+i,win_messages+i+1,(--win_message_count-i)*sizeof *win_messages);}
        else i++;
    }
    if(win_foreground==handle)win_foreground=0;if(win_focus==handle)win_focus=0;
    memset(w,0,sizeof *w);w->generation=generation;
}
static int win_destroy(guest_window *w) {
    if(w==win_windows || w->owner!=guest_tid()){last_error=5;return 0;}
    if(w->destroying)return 1;w->destroying=1;
    for(unsigned i=1;i<64;i++)if(win_windows[i].handle && win_windows[i].parent==w->handle && (win_windows[i].style&0x40000000))win_destroy(win_windows+i);
    win_send(w,2,0,0);win_send(w,0x82,0,0);win_free_window(w);return 1;
}
static uint32_t win_size(guest_window *w) {
    uint32_t x=w->width-w->left-w->right,y=w->height-w->top-w->bottom;
    return (x&0xFFFF)|(y<<16);
}
static void win_activate(guest_window *w) {
    uint32_t old=win_foreground,focus=win_focus;
    if(old==w->handle)return;
    win_foreground=win_focus=w->handle;
    guest_window *previous=win_get(old);if(previous){win_send(previous,0x86,0,w->handle);win_send(previous,6,0,w->handle);}
    previous=win_get(focus);if(previous)win_send(previous,8,w->handle,0);
    win_send(w,0x86,1,old);win_send(w,6,1,old);win_send(w,7,focus,0);
}
static uint32_t win_default(guest_window *w,uint32_t message,uint32_t wp,uint32_t lp) {
    switch(message) {
    case 0x81:return 1;
    case 0x83:
        if(lp){MEM32(lp)+=w->left;MEM32(lp+4)+=w->top;MEM32(lp+8)-=w->right;MEM32(lp+12)-=w->bottom;}return 0;
    case 0x24:
        if(lp){MEM32(lp+8)=win_windows[0].width;MEM32(lp+12)=win_windows[0].height;MEM32(lp+24)=112;MEM32(lp+28)=27;
            MEM32(lp+32)=win_windows[0].width;MEM32(lp+36)=win_windows[0].height;}return 0;
    case 0x10:win_destroy(w);return 0;
    case 0xF:w->paint=0;return 0;
    case 0x14:return 1;
    case 0x46:return 0;
    case 0x47:
        if(lp){uint32_t flags=MEM32(lp+24);
            if(!(flags&2))win_send(w,3,0,((uint32_t)(w->x+w->left)&0xFFFF)|((uint32_t)(w->y+w->top)<<16));
            if(!(flags&1))win_send(w,5,w->iconic?1:0,win_size(w));}return 0;
    case 0x84:return 1;
    default:return 0;
    }
}
static uint32_t win_create(void) {
    uint32_t a[12];for(unsigned i=0;i<12;i++)a[i]=argument(i);
    guest_class *c=win_class(a[1],a[10]);if(!c){last_error=1407;return 0;}
    if((a[3]&0x40000000)&&!win_get(a[8])){last_error=1400;return 0;}
    unsigned slot;for(slot=1;slot<64 && win_windows[slot].handle;slot++);
    if(slot==64){last_error=8;return 0;}
    guest_window *w=win_windows+slot;uint32_t gen=(w->generation+1)&0xFFFF;if(!gen)gen=1;
    *w=(guest_window){.handle=0x74000000|(gen<<8)|slot,.generation=gen,.owner=guest_tid(),.procedure=c->procedure,.atom=c->atom,
        .instance=a[10],.parent=a[8],.menu=a[9],.style=a[3],.extended=a[0],.extra_size=c->extra,
        .x=a[4]==0x80000000?0:(int32_t)a[4],.y=a[5]==0x80000000?0:(int32_t)a[5],
        .width=a[6]==0x80000000?640:(int32_t)a[6],.height=a[7]==0x80000000?480:(int32_t)a[7]};
    if(w->width<0)w->width=0;if(w->height<0)w->height=0;
    if(c->extra)w->extra=allocate(c->extra);
    if(a[2])snprintf(w->title,sizeof w->title,"%s",(const char*)ADDR(a[2]));
    win_insets(w->style,w->extended,w->menu && !(w->style&0x40000000),&w->left,&w->top,&w->right,&w->bottom);
    /* Temporary CREATESTRUCT, MINMAXINFO and RECT remain valid across nested guest calls. */
    uint32_t temp=allocate(112),create[]={a[11],a[10],a[9],a[8],(uint32_t)w->height,(uint32_t)w->width,(uint32_t)w->y,(uint32_t)w->x,a[3],a[2],a[1],a[0]};
    memcpy((void*)ADDR(temp),create,sizeof create);
    if(!(w->style&0x40000000))win_send(w,0x24,0,temp+48);
    int nc=win_send(w,0x81,0,temp)!=0,ok=0;
    if(nc && w->handle){
        uint32_t rect=temp+96;MEM32(rect)=w->x;MEM32(rect+4)=w->y;MEM32(rect+8)=w->x+w->width;MEM32(rect+12)=w->y+w->height;
        win_send(w,0x83,0,rect);
        w->left=MEM32(rect)-w->x;w->top=MEM32(rect+4)-w->y;
        w->right=w->x+w->width-MEM32(rect+8);w->bottom=w->y+w->height-MEM32(rect+12);
        ok=win_send(w,1,0,temp)!=0xFFFFFFFFu;
    }
    guest_block *block=find_block(temp,1);if(block)release_block(block);
    if(!ok||!w->handle){if(w->handle){if(nc)win_send(w,2,0,0);win_send(w,0x82,0,0);win_free_window(w);}last_error=1407;return 0;}
    win_send(w,5,0,win_size(w));win_send(w,3,0,((uint32_t)(w->x+w->left)&0xFFFF)|((uint32_t)(w->y+w->top)<<16));
    if(w->style&0x10000000){w->visible=w->paint=1;win_send(w,0x18,1,0);win_activate(w);}
    return w->handle;
}
static int win_is_child(uint32_t child,uint32_t parent) {
    for(unsigned i=0;i<64 && child;i++){if(child==parent)return 1;guest_window *w=win_get(child);if(!w||!(w->style&0x40000000))break;child=w->parent;}return 0;
}
static uint32_t win_get_message(uint32_t out,uint32_t hwnd,uint32_t low,uint32_t high) {
    if(!out || (hwnd && hwnd!=0xFFFFFFFFu && !win_get(hwnd))){last_error=hwnd?1400:87;return 0xFFFFFFFFu;}
    for(;;) {
        for(unsigned i=0;i<win_message_count;i++) {
            guest_message m=win_messages[i];if(m.owner!=guest_tid())continue;
            if(!m.notify && m.message!=0x12 && ((hwnd==0xFFFFFFFFu?m.hwnd!=0:hwnd&&!win_is_child(m.hwnd,hwnd)) || ((low||high)&&(m.message<low||m.message>high))))continue;
            memmove(win_messages+i,win_messages+i+1,(--win_message_count-i)*sizeof *win_messages);
            if(m.notify){guest_window *w=win_get(m.hwnd);if(w)win_send(w,m.message,m.wparam,m.lparam);i=(unsigned)-1;continue;}
            memcpy((void*)ADDR(out),&m.hwnd,28);return m.message!=0x12;
        }
        if(hwnd!=0xFFFFFFFFu && (!(low||high)||(low<=0xF&&high>=0xF)))for(unsigned i=1;i<64;i++) {
            guest_window *w=win_windows+i;if(w->handle&&w->owner==guest_tid()&&w->paint&&w->visible&&(!hwnd||win_is_child(w->handle,hwnd))) {
                uint32_t msg[]={w->handle,0xF,0,0,win_ticks(),(uint32_t)di_cursor[0],(uint32_t)di_cursor[1]};memcpy((void*)ADDR(out),msg,28);return 1;
            }
        }
        if(emscripten_get_now()>deadline)fail(g_cur_func,"Window message wait budget reached at %08X",g_cur_func);
        machine_pause(1000);
    }
}
/* DOM callbacks enqueue only. Guest window procedures run on the owning VM thread. */
static void win_input_key(uint32_t scan,uint32_t down,uint32_t previous) {
    uint32_t vk=0;for(uint32_t i=1;i<256;i++)if(di_scan(i)==scan){vk=i;break;}
    if(!vk){
        switch(scan){
        case 0x9C:vk=13;break;case 0x0C:vk=0xBD;break;case 0x0D:vk=0xBB;break;
        case 0x1A:vk=0xDB;break;case 0x1B:vk=0xDD;break;case 0x27:vk=0xBA;break;
        case 0x28:vk=0xDE;break;case 0x29:vk=0xC0;break;case 0x2B:vk=0xDC;break;
        case 0x33:vk=0xBC;break;case 0x34:vk=0xBE;break;case 0x35:vk=0xBF;break;
        default:return;
        }
    }
    if(vk==0xA0||vk==0xA1)vk=16;if(vk==0xA2||vk==0xA3)vk=17;if(vk==0xA4||vk==0xA5)vk=18;
    guest_window *w=win_get(win_focus?win_focus:win_foreground);if(!w)return;
    uint32_t flags=1|((scan&0x7F)<<16)|((scan&0x80)?1<<24:0)|(previous?1u<<30:0)|(down?0:1u<<31);
    int alt=di_keys[0x38]||di_keys[0xB8];if(alt)flags|=1<<29;
    win_post(w->handle,(alt?0x104:0x100)+(down?0:1),vk,flags,0);
}
static void win_input_focus(uint32_t focused) {
    guest_window *w=win_get(win_foreground);if(!w)return;
    win_post(w->handle,0x1C,focused,guest_tid(),0);win_post(w->handle,6,focused?1:0,0,0);
    win_post(w->handle,focused?7:8,0,0,0);
}
static uint32_t win_mouse_keys(uint32_t buttons) {
    return (buttons&3)|((buttons&4)?16:0)|((di_keys[0x2A]||di_keys[0x36])?4:0)|((di_keys[0x1D]||di_keys[0x9D])?8:0);
}
static void win_input_mouse(int32_t wheel,uint32_t previous,uint32_t buttons) {
    guest_window *w=win_get(win_focus?win_focus:win_foreground);if(!w)return;
    int32_t x,y;win_origin(w,&x,&y);
    uint32_t keys=win_mouse_keys(buttons),xy=((uint32_t)(di_cursor[0]-x)&0xFFFF)|((uint32_t)(di_cursor[1]-y)<<16);
    if(wheel)win_post(w->handle,0x20A,keys|((uint32_t)wheel<<16),((uint32_t)di_cursor[0]&0xFFFF)|((uint32_t)di_cursor[1]<<16),0);
    for(unsigned i=0;i<3;i++)if((previous^buttons)&(1u<<i))win_post(w->handle,0x201+i*3+((buttons&(1u<<i))?0:1),keys,xy,0);
}
static void win_input_cursor(int32_t x,int32_t y) {
    guest_window *w=win_get(win_focus?win_focus:win_foreground);
    int32_t ox=0,oy=0;if(w)win_origin(w,&ox,&oy);
    di_cursor[0]=x+ox;di_cursor[1]=y+oy;
    if(w)win_post(w->handle,0x200,win_mouse_keys(di_buttons),((uint32_t)x&0xFFFF)|((uint32_t)y<<16),0);
}
static void win_render_size(uint32_t width,uint32_t height) {
    win_windows[0].width=width;win_windows[0].height=height;
    guest_window *w=win_get(win_foreground);
    if(!w||w==win_windows)return;
    int32_t outer_width=width+w->left+w->right,outer_height=height+w->top+w->bottom;
    if(w->width==outer_width&&w->height==outer_height)return;
    w->width=outer_width;w->height=outer_height;w->paint=1;
    win_post(w->handle,5,w->iconic?1:0,(width&0xFFFF)|(height<<16),0);
}
static int win_import(const char *name) {
    if(!strcmp(name,"RegisterClassA")) {
        uint32_t p=argument(0);if(!p||!MEM32(p+4)||!MEM32(p+36)||MEM32(p+12)>4096||MEM32(p+8)>4096){last_error=87;result(0,1);return 1;}
        if(win_class(MEM32(p+36),MEM32(p+16))){last_error=1410;result(0,1);return 1;}
        for(unsigned i=0;i<64;i++)if(!win_classes[i].atom){guest_class *c=win_classes+i;
            *c=(guest_class){++win_next_atom,MEM32(p),MEM32(p+4),MEM32(p+16),MEM32(p+12),MEM32(p+24),MEM32(p+28)};
            snprintf(c->name,sizeof c->name,"%s",(const char*)ADDR(MEM32(p+36)));result(c->atom,1);return 1;
        }last_error=8;result(0,1);return 1;
    }
    if(!strcmp(name,"UnregisterClassA")) {
        guest_class *c=win_class(argument(0),argument(1));if(!c){last_error=1411;result(0,2);return 1;}
        for(unsigned i=1;i<64;i++)if(win_windows[i].handle&&win_windows[i].atom==c->atom){last_error=1412;result(0,2);return 1;}
        memset(c,0,sizeof *c);result(1,2);return 1;
    }
    if(!strcmp(name,"CreateWindowExA")){uint32_t hwnd=win_create();result(hwnd,12);return 1;}
    if(!strcmp(name,"DefWindowProcA")) {
        guest_window *w=win_get(argument(0));uint32_t value=w?win_default(w,argument(1),argument(2),argument(3)):0;result(value,4);return 1;
    }
    if(!strcmp(name,"FindWindowA")) {
        uint32_t cls=argument(0),title=argument(1),hwnd=0;guest_class *c=cls?win_class(cls,0):NULL;
        for(unsigned i=1;i<64;i++){guest_window *w=win_windows+i;
            if(w->handle&&!(w->style&0x40000000)&&(!cls||(c&&c->atom==w->atom))&&(!title||!strcasecmp(w->title,(const char*)ADDR(title)))){hwnd=w->handle;break;}}
        result(hwnd,2);return 1;
    }
    if(!strcmp(name,"AdjustWindowRect")||!strcmp(name,"AdjustWindowRectEx")) {
        uint32_t p=argument(0);int ex=!strcmp(name,"AdjustWindowRectEx");if(!p){last_error=87;result(0,ex?4:3);return 1;}
        int32_t l,t,r,b;win_insets(argument(1),ex?argument(3):0,argument(2)!=0,&l,&t,&r,&b);
        MEM32(p)-=l;MEM32(p+4)-=t;MEM32(p+8)+=r;MEM32(p+12)+=b;result(1,ex?4:3);return 1;
    }
    if(!strcmp(name,"PostMessageA")){int ok=win_post(argument(0),argument(1),argument(2),argument(3),0);result(ok,4);return 1;}
    if(!strcmp(name,"PostThreadMessageA")) {
        uint32_t tid=argument(0);int valid=0;for(unsigned i=0;i<8;i++)if(guest_threads[i].used&&!guest_threads[i].done&&guest_threads[i].id==tid)valid=1;
        if(!valid)last_error=1444;result(valid?win_enqueue(tid,0,argument(1),argument(2),argument(3),0):0,4);return 1;
    }
    if(!strcmp(name,"PostQuitMessage")){win_enqueue(guest_tid(),0,0x12,argument(0),0,0);result(0,1);return 1;}
    if(!strcmp(name,"SendNotifyMessageA")) {
        guest_window *w=win_get(argument(0));int ok=1;
        if(w&&w->owner==guest_tid())win_send(w,argument(1),argument(2),argument(3));else ok=win_post(argument(0),argument(1),argument(2),argument(3),1);
        result(ok,4);return 1;
    }
    if(!strcmp(name,"GetMessageA")){uint32_t value=win_get_message(argument(0),argument(1),argument(2),argument(3));result(value,4);return 1;}
    if(!strcmp(name,"DispatchMessageA")) {
        uint32_t p=argument(0);guest_window *w=p?win_get(MEM32(p)):NULL;
        if(w&&w->owner!=guest_tid()){last_error=5;result(0,1);return 1;}
        uint32_t value=w?win_send(w,MEM32(p+4),MEM32(p+8),MEM32(p+12)):0;result(value,1);return 1;
    }
    if(!strcmp(name,"TranslateMessage")) {
        uint32_t p=argument(0),m=p?MEM32(p+4):0;int keyboard=m>=0x100&&m<=0x105;
        if(m==0x100||m==0x104){uint32_t vk=MEM32(p+8),ch=0;int shift=di_keys[0x2A]||di_keys[0x36];
            if(vk>='A'&&vk<='Z')ch=vk+((shift!=!!di_toggled[0x3A])?0:32);
            else if(vk>='0'&&vk<='9')ch=shift?(uint8_t)")!@#$%^&*("[vk-'0']:vk;
            else if(vk==8||vk==9||vk==13||vk==27||vk==32)ch=vk;
            else {
                const uint32_t codes[]={0xBA,0xBB,0xBC,0xBD,0xBE,0xBF,0xC0,0xDB,0xDC,0xDD,0xDE};
                const char *chars=shift?":+<_>?~{|}\"":";=,-./`[\\]'";
                for(unsigned i=0;i<11;i++)if(vk==codes[i])ch=(uint8_t)chars[i];
            }
            if((di_keys[0x1D]||di_keys[0x9D])&&vk>='A'&&vk<='Z')ch=vk-'A'+1;
            if(ch)win_post(MEM32(p),m==0x104?0x106:0x102,ch,MEM32(p+12),0);
        }result(keyboard,1);return 1;
    }
    if(!strcmp(name,"SystemParametersInfoA")) {
        uint32_t action=argument(0),p=argument(2);int ok=0;
        if(action==0x30&&p){MEM32(p)=MEM32(p+4)=0;MEM32(p+8)=win_windows[0].width;MEM32(p+12)=win_windows[0].height-23;ok=1;}
        if(!ok)last_error=50;result(ok,4);return 1;
    }
    if(!strcmp(name,"SetWindowsHookExA")){last_error=50;result(0,4);return 1;}
    if(!strcmp(name,"UnhookWindowsHookEx")){last_error=1404;result(0,1);return 1;}
    if(!strcmp(name,"CallNextHookEx")){result(0,4);return 1;}
    if(!strcmp(name,"ShowWindow")||!strcmp(name,"SetActiveWindow")||!strcmp(name,"SetForegroundWindow")||!strcmp(name,"DestroyWindow")||
       !strcmp(name,"IsIconic")||!strcmp(name,"SetWindowPos")||!strcmp(name,"BeginPaint")||!strcmp(name,"EndPaint")) {
        guest_window *w=win_get(argument(0));unsigned argc=!strcmp(name,"SetWindowPos")?7:(!strcmp(name,"ShowWindow")||!strcmp(name,"BeginPaint")||!strcmp(name,"EndPaint"))?2:1;
        if(!w){last_error=1400;result(0,argc);return 1;}
        uint32_t value=0;
        if(!strcmp(name,"DestroyWindow"))value=win_destroy(w);
        else if(!strcmp(name,"IsIconic"))value=w->iconic;
        else if(!strcmp(name,"SetActiveWindow")||!strcmp(name,"SetForegroundWindow")){value=!strcmp(name,"SetActiveWindow")?win_foreground:1;win_activate(w);}
        else if(!strcmp(name,"ShowWindow")) {
            uint32_t command=argument(1);value=w->visible;w->visible=command!=0;w->iconic=command==2||command==6||command==7;
            if(w->visible)w->style|=0x10000000;else w->style&=~0x10000000;
            win_send(w,0x18,w->visible,0);if(w->visible){w->paint=1;if(command!=4&&command!=8&&command!=7)win_activate(w);}
        }else if(!strcmp(name,"SetWindowPos")) {
            uint32_t p=allocate(80),pos[]={w->handle,argument(1),argument(2),argument(3),argument(4),argument(5),argument(6)};
            memcpy((void*)ADDR(p),pos,28);if(!(pos[6]&0x400))win_send(w,0x46,0,p);memcpy(pos,(const void*)ADDR(p),28);
            uint32_t flags=pos[6];if(!(flags&2)){w->x=pos[2];w->y=pos[3];}if(!(flags&1)){w->width=(int32_t)pos[4]>0?pos[4]:0;w->height=(int32_t)pos[5]>0?pos[5]:0;}
            if(!(flags&1)||(flags&0x20)) {
                uint32_t rect=p+28;MEM32(rect)=w->x;MEM32(rect+4)=w->y;MEM32(rect+8)=w->x+w->width;MEM32(rect+12)=w->y+w->height;
                MEM32(rect+48)=p;win_send(w,0x83,1,rect);
                w->left=MEM32(rect)-w->x;w->top=MEM32(rect+4)-w->y;w->right=w->x+w->width-MEM32(rect+8);w->bottom=w->y+w->height-MEM32(rect+12);
            }
            if(flags&0x40){w->visible=1;w->style|=0x10000000;w->paint=1;}if(flags&0x80){w->visible=0;w->style&=~0x10000000;}
            if(!(flags&0x10))win_activate(w);win_send(w,0x47,0,p);guest_block *b=find_block(p,1);if(b)release_block(b);value=1;
        }else if(!strcmp(name,"BeginPaint")) {
            uint32_t p=argument(1);if(p){memset((void*)ADDR(p),0,64);w->dc_refs++;value=0x75000000|(w->handle&0xFFFFFF);MEM32(p)=value;MEM32(p+4)=1;
                MEM32(p+16)=w->width-w->left-w->right;MEM32(p+20)=w->height-w->top-w->bottom;w->paint=0;}
        }else {if(w->dc_refs)w->dc_refs--;value=1;}
        result(value,argc);return 1;
    }
    if (!strcmp(name, "GetDesktopWindow")) { result(WIN_DESKTOP, 0); return 1; }
    if (!strcmp(name, "GetForegroundWindow")) { result(di_focused ? win_foreground : 0, 0); return 1; }
    if (!strcmp(name, "GetWindowDC")) {
        guest_window *window = win_get(argument(0) ? argument(0) : WIN_DESKTOP);
        if (!window) { last_error = 1400; result(0, 1); return 1; }
        window->dc_refs++; result(0x75000000 | (window->handle & 0x00FFFFFF), 1); return 1;
    }
    if (!strcmp(name, "ReleaseDC")) {
        guest_window *window = win_get(argument(0) ? argument(0) : WIN_DESKTOP);
        if (!window || !window->dc_refs || argument(1) != (0x75000000 | (window->handle & 0x00FFFFFF))) { result(0, 2); return 1; }
        window->dc_refs--; result(1, 2); return 1;
    }
    if (!strcmp(name, "GetSystemMetrics")) {
        uint32_t value = 0;
        switch (argument(0)) {
        case 0: case 16: case 78: value = win_windows[0].width; break;
        case 1: case 79: value = win_windows[0].height; break;
        case 17: value = win_windows[0].height - 23; break;
        case 2: case 3: case 9: case 10: case 20: case 21: value = 17; break;
        case 4: value = 23; break; case 5: case 6: case 19: case 80: value = 1; break;
        case 7: case 8: case 43: value = 3; break;
        case 11: case 12: case 13: case 14: value = 32; break; case 15: value = 19; break;
        case 28: case 34: value = 112; break; case 29: case 35: value = 27; break;
        case 30: case 31: value = 18; break; case 32: case 33: value = 8; break;
        }
        result(value, 1); return 1;
    }
    if (!strcmp(name, "LoadIconA") || !strcmp(name, "LoadCursorA")) {
        uint32_t resource = argument(1);
        if (!resource || resource > 0xFFFF) { last_error = 1813; result(0, 2); return 1; }
        result((!strcmp(name, "LoadCursorA") ? 0x76000000 : 0x77000000) | resource, 2); return 1;
    }
    if (!strcmp(name, "SetCursor")) { uint32_t old = win_cursor; win_cursor = argument(0); result(old, 1); return 1; }
    if (!strcmp(name, "ShowCursor")) { win_cursor_count += argument(0) ? 1 : -1; result((uint32_t)win_cursor_count, 1); return 1; }
    if (!strcmp(name, "GetWindowLongA")) {
        guest_window *window = win_get(argument(0)); int32_t index = (int32_t)argument(1);
        if (!window) { last_error = 1400; result(0, 2); return 1; }
        uint32_t value;
        switch (index) {
        case -4: value = window->procedure; break; case -6: value = window->instance; break;
        case -8: value = window->parent; break; case -12: value = window->menu; break;
        case -16: value = window->style; break; case -20: value = window->extended; break;
        case -21: value = window->user; break;
        default:
            if (index < 0 || index % 4 || (uint32_t)index + 4 > window->extra_size) { last_error = 1413; result(0, 2); return 1; }
            value = MEM32(window->extra + index);
        }
        result(value, 2); return 1;
    }
    if (!strcmp(name, "GetClientRect")) {
        guest_window *window = win_get(argument(0)); uint32_t out = argument(1);
        if (!window || !out) { last_error = window ? 87 : 1400; result(0, 2); return 1; }
        MEM32(out) = MEM32(out + 4) = 0;
        MEM32(out + 8) = window->width - window->left - window->right;
        MEM32(out + 12) = window->height - window->top - window->bottom; result(1, 2); return 1;
    }
    if (!strcmp(name, "ScreenToClient") || !strcmp(name, "ClientToScreen")) {
        guest_window *window = win_get(argument(0)); uint32_t point = argument(1);
        if (!window || !point) { last_error = window ? 87 : 1400; result(0, 2); return 1; }
        int sign = !strcmp(name, "ClientToScreen") ? 1 : -1;int32_t x,y;win_origin(window,&x,&y);
        MEM32(point) += sign*x; MEM32(point + 4) += sign*y;
        result(1, 2); return 1;
    }
    return 0;
}
static int win_gdi_import(const char *name) {
    if (!strcmp(name, "GetStockObject")) { uint32_t index = argument(0); result(index <= 19 ? 0x78000000 | index : 0, 1); return 1; }
    if (!strcmp(name, "GetDeviceCaps")) {
        uint32_t dc = argument(0), value = 0;
        guest_window *window = (dc & 0xFF000000) == 0x75000000 ? win_get(0x74000000 | (dc & 0xFFFFFF)) : NULL;
        if (!window || !window->dc_refs) { last_error = 6; result(0, 2); return 1; }
        switch (argument(1)) {
        case 0: value = 0x400; break; case 2: value = 1; break;
        case 4: value = win_windows[0].width * 254 / 960; break;
        case 6: value = win_windows[0].height * 254 / 960; break;
        case 8: case 118: value = win_windows[0].width; break;
        case 10: case 117: value = win_windows[0].height; break;
        case 12: value = 32; break; case 14: case 116: value = 1; break;
        case 24: value = 0xFFFFFFFF; break; case 88: case 90: value = 96; break;
        }
        result(value, 2); return 1;
    }
    return 0;
}
#endif
