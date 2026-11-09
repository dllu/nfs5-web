// Thrash TL vertices: screen XY, normalized Z, reciprocal W, ARGB diffuse,
// ARGB specular/fog, UV. Shading follows the supplied Verok OpenGL3 renderer:
// flat/Gouraud diffuse, texture RGBA modulation, optional specular addition.
struct Effects {
    view: vec4f,
    fog_color: vec4f,
    effects: vec4f,
    fog_params: vec4f,
    gamma: vec4f,
};
@group(0) @binding(0) var<uniform> fx: Effects;
@group(1) @binding(0) var image: texture_2d<f32>;
@group(1) @binding(1) var image_sampler: sampler;
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(linear) color: vec4f,
    @location(1) @interpolate(linear) projected_uv: vec3f,
    @location(2) @interpolate(linear) fog_amount: f32,
    @location(4) @interpolate(flat) flat_color: vec4f,
    @location(5) @interpolate(linear) specular: vec4f,
};
@vertex fn vertex_main(@location(0) position: vec4f, @location(1) color: vec4f,
                      @location(2) specular: vec4f, @location(3) uv: vec2f) -> VertexOutput {
    var output: VertexOutput;
    // Native clip-space W is one: RHW affects texture projection and fog,
    // not geometry clipping. Depth above one resets to zero; negative depth
    // reaches the clipper. WebGPU's depth range directly represents TL Z.
    output.position = vec4f(position.x * 2.0 / fx.view.x - 1.0,
                           1.0 - position.y * 2.0 / fx.view.y,
                           select(0.0, position.z, position.z <= 1.0), 1.0);
    output.color = color.bgra;
    output.flat_color = color.bgra;
    output.specular = specular.bgra;
    output.projected_uv = vec3f(uv * position.w, position.w);
    // Verok calculates fog at vertices, then interpolates its amount in screen
    // space. The ARGB fog color's alpha controls its maximum strength.
    var fog_amount = 1.0 - specular.a;
    if fx.fog_params.x > 0.5 {
        var depth = 1.0;
        if position.w != 0.0 { depth = 1.0 / position.w; }
        var visibility = (fx.fog_params.w - depth) / (fx.fog_params.w - fx.fog_params.z);
        let amount = fx.fog_params.y * depth;
        if fx.fog_params.x > 2.5 { visibility = exp2(amount * amount * -1.442695); }
        else if fx.fog_params.x > 1.5 { visibility = exp(-amount); }
        fog_amount = (1.0 - clamp(visibility, 0.0, 1.0)) * fx.fog_color.a;
    }
    output.fog_amount = fog_amount;
    return output;
}
@fragment fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let texture_flags = u32(fx.effects.w);
    var texel = vec4f(1.0);
    if (texture_flags & 2u) != 0u {
        texel = textureSampleBias(image, image_sampler, input.projected_uv.xy / input.projected_uv.z, fx.view.w);
    }
    var diffuse = input.color;
    if fx.view.z < 0.5 { diffuse = input.flat_color; }
    var color = vec4f(texel.rgb * diffuse.rgb, texel.a);
    if (texture_flags & 1u) != 0u { color.a *= diffuse.a; }
    if fx.view.z > 1.5 { color += input.specular; }
    switch u32(fx.effects.x) {
        case 0u: { discard; }
        case 1u: { if color.a >= fx.effects.y { discard; } }
        case 2u: { if color.a != fx.effects.y { discard; } }
        case 3u: { if color.a > fx.effects.y { discard; } }
        case 4u: { if color.a <= fx.effects.y { discard; } }
        case 5u: { if color.a == fx.effects.y { discard; } }
        case 6u: { if color.a < fx.effects.y { discard; } }
        default: {}
    }
    if fx.effects.z > 0.5 {
        color = vec4f(mix(color.rgb, fx.fog_color.rgb, clamp(input.fog_amount, 0.0, 1.0)), color.a);
    }
    if fx.gamma.x != 1.0 {
        color = vec4f(pow(color.rgb, vec3f(1.0 / fx.gamma.x)), color.a);
    }
    return color;
}
