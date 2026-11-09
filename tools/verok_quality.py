"""Generate the supplied Verok 1.06 texture-selection and five-level car hooks."""
import hashlib
from pathlib import Path
import re
import struct

from tools.lift.translator import load_pe, discover_functions
from tools.lift.lift32 import Lifter

IMAGE_SHA = 'c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906'
LIBRARY_SHA = 'f24b5c82404f403645e5bc3e52d47e4dd6d19bd92613c243ac31bea285fce758'


class QualityHooks:
    def __init__(self, library: Path, output: Path):
        if hashlib.sha256(library.read_bytes()).hexdigest() != LIBRARY_SHA:
            raise ValueError('Expected the supplied Verok 1.06 nfs5.dll for graphics-quality hooks')
        info, data, iat = load_pe(str(library))
        functions = discover_functions(data, info, iat)
        car = functions[0x10001090]
        car.name = 'web_verok_car_layers'
        source = Lifter(iat_map=iat, lifted=set(functions)).lift_function(car)
        # These are the patch's six read-only mesh/LOD tables. Keep binary-derived
        # tables in generated output; DLL addresses need no guest-memory mapping.
        tables = {}
        for section in info.sections:
            if section.name == '.rdata':
                offset = section.raw_offset + 0x5094 - section.virtual_address
                tables = struct.unpack('<' + 'I' * ((0x51A4 - 0x5094) // 4), data[offset:offset + 0x110])
        if not tables:
            raise ValueError('Missing Verok car-detail tables')
        source, count = re.subn(r'MEM32\(([^()]*\+ 0x10005[0-9A-F]{3})\)', r'web_verok_quality_table(\1)', source)
        if count != 6 or 'UNIMPLEMENTED' in source:
            raise ValueError('Verok car-layer translation changed')
        header = ('#pragma once\n#include <stdint.h>\n'
                  'void web_verok_car_layers(void);\n'
                  'static inline uint32_t web_verok_quality_table(uint32_t address) {\n'
                  '    static const uint32_t values[] = {' + ','.join(map(str, tables)) + '};\n'
                  '    return values[(address - 0x10005094u) / 4];\n}\n'
                  'static inline uint32_t web_verok_car_budget(uint32_t level) {\n'
                  '    static const uint32_t values[] = {5,4,3,2,1};\n'
                  '    return values[level];\n}\n')
        (output / 'verok_quality.h').write_text(header)
        (output / 'verok_quality.c').write_text('#define RECOMP_GENERATED_CODE\n#include "web_runtime.h"\n#include "verok_quality.h"\n' + source)
        self.counts = {}

    def apply(self, address, source):
        def instruction(pc, replacement):
            nonlocal source
            pattern = r'(?m)^.*?/\* 0x' + pc + r':[^\n]*$'
            source, count = re.subn(pattern, replacement, source)
            self.counts[pc] = self.counts.get(pc, 0) + count

        if address == 0x0044DFB0:
            # nfs5.dll:10001030 replaces the old CPU/VRAM autodetect call. The
            # selected texture tier is preserved; 16-bit modes cap tiers 3/4.
            source = '''void sub_0044DFB0(void) {
    uint32_t _flag_k = FK_NONE, _flag_a = 0, _flag_b = 0, _cf = 0;
    RECOMP_ENTER(0x0044DFB0u);
    eax = MEM32(0x657D88);
    _flag_k = FK_CMP; _flag_a = eax; _flag_b = 3; _cf = CMP_B(_flag_a, _flag_b);
    if (eax >= 3) {
        _flag_a = MEM32(0x61978C); _flag_b = 32; _cf = CMP_B(_flag_a, _flag_b);
        if (_flag_a < 32) eax = 2;
    }
    MEM32(0x619770) = eax;
    RECOMP_FLAGS_OUT();
    esp += 4;
}
'''
            self.counts['0044DFB0'] = 1
        if address == 0x00444E00:
            # Thiscall-to-cdecl wrapper at nfs5.dll:100012C0.
            source = '''void sub_00444E00(void) {
    uint32_t _flag_k = FK_NONE, _flag_a = 0, _flag_b = 0, _cf = 0;
    RECOMP_ENTER(0x00444E00u);
    eax = MEM32(esp + 4);
    PUSH32(esp, eax);
    PUSH32(esp, ecx);
    RECOMP_CALL(web_verok_car_layers);
    esp += 8;
}
'''
            self.counts['00444E00'] = 1
        # Apply to every recovered copy, including shared/inlined function tails.
        instruction('004E5816', '    PUSH32(esp, 0x005B6D5Cu); /* Verok: five car-detail labels */')
        instruction('0043A083', '    ebx = web_verok_car_budget(ebx); /* Verok: five car-detail budgets */')
        instruction('0043A08A', '    eax = MEM32(ebp - 0x20); /* Verok: selected detail tier */')
        instruction('0043A3B6', '    eax = MEM32(esi + 0x2C0); if (!eax) eax = 1; /* Verok: minimum layer */')
        if '/* 0x004E5B86:' in source:
            # Browser policy, after original hardware autodetection. The game
            # regenerates XXDefXX.sav from these properties during startup;
            # editing the installed template alone is consequently ineffective.
            original = self._line(source, '004E5B86')
            instruction('004E5B86', original + '''
    RECOMP_FLAGS_IN();
    {
        const uint32_t group = esi;
        static const uint32_t defaults[][2] = {
            {4,26}, {0xC,2}, {0x10,4}, {0x14,3}, {0x1C,3},
            {0x20,1}, {0x24,1}, {0x2C,4}, {0x40,2}
        };
        for (unsigned i = 0; i < sizeof defaults / sizeof defaults[0]; i++) {
            ecx = MEM32(group + defaults[i][0]); eax = MEM32(ecx);
            PUSH32(esp, defaults[i][1]);
            RECOMP_ICALL(MEM32(eax + 0x2C));
            RECOMP_FLAGS_IN();
        }
    }''')
        if '/* 0x0044EF8B:' in source:
            instruction('0044EF8B', '    MEM32(0x6197C4) = ecx; goto WEB_QUALITY_EFAD;')
            instruction('0044EFAD', 'WEB_QUALITY_EFAD:\n    /* Verok resumes at the original capability check. */\n    ' + self._line(source, '0044EFAD'))
        if '/* 0x0044F110:' in source:
            instruction('0044F110', '    edx = eax; MEM32(0x6197C4) = edx; eax = 5 - edx; goto WEB_QUALITY_F133;')
            instruction('0044F133', 'WEB_QUALITY_F133:\n    ' + self._line(source, '0044F133'))
        return source

    @staticmethod
    def _line(source, pc):
        return next(line.strip() for line in source.splitlines() if '/* 0x' + pc + ':' in line)

    def validate(self):
        for pc in ['0044DFB0', '00444E00', '004E5816', '0043A083', '0043A08A',
                   '0043A3B6', '0044EF8B', '0044EFAD', '0044F110', '0044F133', '004E5B86']:
            if not self.counts.get(pc):
                raise ValueError('Missing Verok quality hook at ' + pc)
