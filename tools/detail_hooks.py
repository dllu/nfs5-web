"""Extend native scene visibility and model LOD without changing game assets."""
import re


class DetailHooks:
    def __init__(self):
        self.counts = {}

    def apply(self, source):
        def replace(pc, transform):
            nonlocal source
            pattern = r'(?m)^.*?/\* 0x' + pc + r':[^\n]*$'
            def patch(match):
                self.counts[pc] = self.counts.get(pc, 0) + 1
                return transform(match[0])
            source = re.sub(pattern, patch, source)

        # The original per-section distance routine has just applied the menu
        # tier and its minimum. Scale once per main view, before publishing the
        # camera's linear/squared visibility bounds. The next frame recomputes
        # the original range, so live changes cannot compound.
        replace('00468A68', lambda line: line + '\n    { extern void web_detail_view(void); web_detail_view(); }')
        # Car LOD uses projected extent in the original 640x480 projection.
        # Increase that extent only at its LOD/three-pixel visibility decision.
        replace('0043A2E5', lambda line: '    { extern double web_detail_car(double); FP_ST(0) = web_detail_car(FP_ST(0)); }\n' + line)
        # Some track objects have independent 600/700-unit cutoffs, even when
        # the camera sees farther. These operands are squared distances.
        for pc, operand in [('0047FA08', '5B47A8'), ('0047FA3D', '5B47AC')]:
            def limit(line, operand=operand):
                target = '(double)*(float*)ADDR(0x' + operand + ')'
                if target not in line:
                    raise ValueError('Scenery cutoff operand changed: ' + line)
                return '    { extern double web_detail_limit(double);\n' + line.replace(target, 'web_detail_limit(' + target + ')') + '\n    }'
            replace(pc, limit)
        # Preserve real distances for culling and occlusion. Bias only the
        # squared-distance argument passed to the scenery model's renderer.
        for pc in ['0047FA20', '0047FA55', '0047FAB2']:
            replace(pc, lambda line: '    { extern double web_detail_model(double); FP_ST(0) = web_detail_model(FP_ST(0)); }\n' + line)
        return source

    def validate(self):
        for pc in ['00468A68', '0043A2E5', '0047FA08', '0047FA3D', '0047FA20', '0047FA55', '0047FAB2']:
            if not self.counts.get(pc):
                raise ValueError('Missing scene-detail hook at ' + pc)
