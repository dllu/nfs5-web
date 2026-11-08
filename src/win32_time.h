/* Browser calendar time and current-year Windows time-zone information. */
#ifndef NFS5_WIN32_TIME_H
#define NFS5_WIN32_TIME_H
EM_JS(int, win_timezone, (uint8_t *out), {
    var now=new Date(),year=now.getFullYear(),zone=new Intl.DateTimeFormat().resolvedOptions().timeZone;
    var key=year+':'+zone,info=Module['webTimezone'];
    if(!info||info.key!==key) {
        var start=new Date(year,0,1).getTime(),end=new Date(year+1,0,1).getTime();
        var previous=new Date(start).getTimezoneOffset(),offsets=new Map([[previous,start]]),changes=[];
        for(var time=start+86400000;time<=end;time=Math.min(time+86400000,end)) {
            var offset=new Date(time).getTimezoneOffset();
            offsets.set(offset,time);
            if(offset!==previous) {
                var lo=time-86400000,hi=time;
                while(hi-lo>1) {
                    var middle=Math.floor((lo+hi)/2);
                    if(new Date(middle).getTimezoneOffset()===previous)lo=middle;else hi=middle;
                }
                // Windows transition fields use the wall time before the change.
                changes.push({time:hi,before:previous,after:offset});previous=offset;
            }
            if(time===end)break;
        }
        info={key,offsets,changes,standard:Math.max(...offsets.keys()),daylight:Math.min(...offsets.keys())};
        Module['webTimezone']=info;
    }
    HEAPU8.fill(0,out,out+172);
    function name(at,position) {
        var parts=new Intl.DateTimeFormat(undefined,{timeZoneName:'long'}).formatToParts(new Date(at));
        var label=parts.find(part=>part.type==='timeZoneName')?.value||zone||'';
        for(var i=0;i<Math.min(label.length,31);i++)HEAPU16[(out+position)/2+i]=label.charCodeAt(i);
    }
    function transition(change,position) {
        var date=new Date(change.time-change.before*60000);
        var fields=[date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDay(),date.getUTCDate(),
            date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds()];
        fields.forEach((value,i)=>HEAPU16[(out+position)/2+i]=value);
    }
    var standard=info.changes.find(change=>change.after===info.standard);
    var daylight=info.changes.find(change=>change.after===info.daylight);
    if(info.offsets.size===2&&info.changes.length===2&&standard&&daylight) {
        HEAP32[out/4]=info.standard;HEAP32[(out+168)/4]=info.daylight-info.standard;
        transition(standard,68);transition(daylight,152);
        name(info.offsets.get(info.standard),4);name(info.offsets.get(info.daylight),88);
        return now.getTimezoneOffset()===info.daylight?2:1;
    }
    // A fixed-offset snapshot also covers zones without DST. Windows' two
    // transition structure cannot describe more complex political changes.
    HEAP32[out/4]=now.getTimezoneOffset();name(now.getTime(),4);return 0;
});
static int time_import(const char *full) {
    if(!strcmp(full,"KERNEL32.dll!GetTimeZoneInformation")) {
        uint32_t out=argument(0);
        if(!out||!web_guest_range(out,172)){last_error=87;result(0xFFFFFFFFu,1);return 1;}
        result(win_timezone((uint8_t*)ADDR(out)),1);return 1;
    }
    if(strcmp(full,"KERNEL32.dll!GetLocalTime")&&strcmp(full,"KERNEL32.dll!GetSystemTime"))return 0;
    uint32_t out=argument(0);
    if(!out||!web_guest_range(out,16)){last_error=87;result(0,1);return 1;}
    /* Preserve integer milliseconds: libc's seconds/nanoseconds conversion can
     * round an epoch-sized double one millisecond below Date.now(). */
    uint64_t millis=(uint64_t)emscripten_date_now();time_t seconds=(time_t)(millis/1000);struct tm civil;
    if(!strcmp(full,"KERNEL32.dll!GetLocalTime"))localtime_r(&seconds,&civil);else gmtime_r(&seconds,&civil);
    uint16_t fields[]={civil.tm_year+1900,civil.tm_mon+1,civil.tm_wday,civil.tm_mday,
        civil.tm_hour,civil.tm_min,civil.tm_sec,millis%1000};
    memcpy((void*)ADDR(out),fields,sizeof fields);result(0,1);return 1;
}
#endif
