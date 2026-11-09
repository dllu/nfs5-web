"""Browser UI layout hooks for the supported executable (separate from Verok)."""
import re

# Screen-size reads in the original 2D controls and HUD displays. Keep
# an explicit instruction list: camera, scene and framebuffer sizes stay native.
WIDTH_READS = '''417A9B 417AB3 41AE23 41B100 41B78E 41BA3B 41BCC5
41CB2A 41CB3B 41DE2F 4218E2 424472 427B0C 428A2F 428B15 42A482
42DF0D 42E082 43296C 432BB6 432C6B 432D3A 434591 434630 434753
4348C5 437363 437482'''.split()
HEIGHT_READS = '''417AA7 417AC3 41AE3D 41B113 41B7BC 41BA53 41BCE3
41CB32 41CB4D 41DE5A 421906 42446D 427B06 427B2C 4289E4 428A4C
428B38 42A4A6 42DF21 42E0B0 432971 432BD9 432CB0 432CFF 4345A4
43463A 434811 43497E 436DFD 437373 4374A8'''.split()
DIRECT_DRAWS = ['419C28', '431369', '432C57', '432CDA', '432D68', '4A53A2', '4A53AA']
MOUSE_READS = ['41B376', '425288', '425873', '425F10', '42607D',
               '42D4F3', '42F2F0', '430E35']


class UiHooks:
    def __init__(self):
        self.counts = {}

    def apply(self, source):
        def instruction(pc, transform):
            nonlocal source
            pattern = r'(?m)^.*?/\* 0x00' + pc + r':[^\n]*$'
            def replace(match):
                self.counts[pc] = self.counts.get(pc, 0) + 1
                return transform(match[0])
            source = re.sub(pattern, replace, source)

        for axis, addresses in enumerate([WIDTH_READS, HEIGHT_READS]):
            for pc in addresses:
                operand = 'MEM32(0x61978' + ('8' if axis else '4') + ')'
                def size(line, operand=operand, axis=axis):
                    if operand not in line:
                        raise ValueError('UI size operand changed: ' + line)
                    return line.replace(operand, f'web_ui_extent({axis})')
                instruction(pc, size)
        # The race-loading screen paints its original 640x480 bitmap first,
        # then centers/presents it separately from the interface command queue.
        # Scope both the tiled draw and software-surface unlock/upload.
        instruction('4A5376', lambda line: line.replace('MEM32(0x5DEACC)', 'web_ui_extent(1)'))
        instruction('4A537B', lambda line: line.replace('MEM32(0x5DEAC8)', 'web_ui_extent(0)'))
        # HUD records are keyed by their logical dimensions. The original
        # anchoring, custom layout editor and serialization use those same units.
        instruction('41E174', lambda line: line + '''
    { uint32_t w = eax; eax = web_ui_layout(w,ecx,0); ecx = web_ui_layout(w,ecx,1); }''')
        # Original modes assumed width alone indicated a larger screen. A tall
        # logical viewport also needs the original bottom-anchor adjustment.
        instruction('41E4A2', lambda line: '    if ((int32_t)edi <= 640 && (int32_t)ebx <= 480) goto L_0041E50B; /* 0x0041E4A2: browser tall UI anchor */')
        # UI consumers get a logical copy of EA's cached mouse record. Preserve
        # the original record for polling, clamping and non-UI input consumers.
        for pc in MOUSE_READS:
            instruction(pc, lambda line: line + '\n    eax = web_ui_mouse(eax);')
        # Button events have a separate Win32-message cache. Convert its getter,
        # leaving both the window messages and the original event cache intact.
        instruction('435420', lambda line: line + '\n    ecx = web_ui_coordinate((int32_t)ecx,0);')
        instruction('435428', lambda line: line + '\n    edx = web_ui_coordinate((int32_t)edx,1);')
        # This queue contains interface quads, sprites, lines and font commands.
        # Scope the final driver submissions, including every recovered exit.
        instruction('41A330', lambda line: '    web_ui_begin();\n' + line)
        for pc in ['41A4FA', '41A504']:
            instruction(pc, lambda line: '    web_ui_end();\n' + line)
        # Some displays, immediate text and the HUD layout-editor grid also
        # have direct draws. Rear-view camera rendering remains outside these
        # scopes and obtains its physical viewport from normalized HUD anchors.
        for pc in DIRECT_DRAWS:
            instruction(pc, lambda line: '    web_ui_begin();\n' + line + '\n    web_ui_end();')
        # The minimap is a camera pass. Its projected vertices are already in
        # physical pixels, so enlarge strokes without scaling their positions.
        if '/* 0x00432B04:' in source:
            instruction('432B04', lambda line: '    web_ui_strokes(1);\n' + line + '\n    web_ui_strokes(0);')
            source = 'void web_ui_strokes(uint32_t active);\n' + source
        return source

    def validate(self):
        for pc in WIDTH_READS + HEIGHT_READS + DIRECT_DRAWS + MOUSE_READS + ['432B04', '4A5376', '4A537B', '41E174', '41E4A2', '435420', '435428', '41A330', '41A4FA', '41A504']:
            if not self.counts.get(pc):
                raise ValueError('Missing browser UI hook at ' + pc)
