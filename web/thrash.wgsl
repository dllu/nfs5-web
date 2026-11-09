// Thrash TL vertices: screen XY, normalized Z, reciprocal W, ARGB diffuse,
// ARGB specular/fog, UV. Shading follows the supplied Verok OpenGL3 renderer:
// flat/Gouraud diffuse, texture RGBA modulation, optional specular addition.
struct Effects {
    view: vec4f,
    fog_color: vec4f,
    effects: vec4f,
    fog_params: vec4f,
};
@group(0) @binding(0) var<uniform> fx: Effects;
@group(1) @binding(0) var image: texture_2d<f32>;
@group(1) @binding(1) var image_sampler: sampler;
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(linear) color: vec4f,
    @location(1) uv: vec2f,
    @location(2) @interpolate(linear) fog: f32,
    @location(3) eye_depth: f32,
    @location(4) @interpolate(flat) flat_color: vec4f,
    @location(5) @interpolate(linear) specular: vec4f,
};
@vertex fn vertex_main(@location(0) position: vec4f, @location(1) color: vec4f,
                      @location(2) specular: vec4f, @location(3) uv: vec2f) -> VertexOutput {
    var w = 1.0;
    if abs(position.w) > 0.0000001 { w = 1.0 / position.w; }
    var output: VertexOutput;
    output.position = vec4f((position.x * 2.0 / fx.view.x - 1.0) * w,
                           (1.0 - position.y * 2.0 / fx.view.y) * w,
                           clamp(position.z, 0.0, 1.0) * w, w);
    output.color = color.bgra;
    output.flat_color = color.bgra;
    output.specular = specular.bgra;
    output.uv = uv;
    output.fog = specular.a;
    output.eye_depth = max(w, 0.0);
    return output;
}
@fragment fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let texel = textureSampleBias(image, image_sampler, input.uv, fx.view.w);
    var diffuse = input.color;
    if fx.view.z < 0.5 { diffuse = input.flat_color; }
    var color = vec4f(texel.rgb * diffuse.rgb, texel.a);
    if fx.effects.w > 0.5 { color.a *= diffuse.a; }
    if fx.view.z > 1.5 { color += input.specular; }
    if fx.effects.x > 0.5 && color.a < fx.effects.y { discard; }
    if fx.effects.z > 0.5 {
        var visibility = clamp(input.fog, 0.0, 1.0);
        let depth = max(input.eye_depth, 0.0);
        let amount = max(fx.fog_params.y, 0.0) * depth;
        if fx.fog_params.x > 2.5 { visibility = exp(-amount * amount); }
        else if fx.fog_params.x > 1.5 { visibility = exp(-amount); }
        else if fx.fog_params.x > 0.5 {
            visibility = clamp((fx.fog_params.w - depth) / max(fx.fog_params.w - fx.fog_params.z, 0.0000001), 0.0, 1.0);
        }
        color = vec4f(mix(fx.fog_color.rgb, color.rgb, clamp(visibility, 0.0, 1.0)), color.a);
    }
    return color;
}
