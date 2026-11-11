// Canopy wind for Godot 4. Vertex colors: R flutter, G phase, B bend (see README.md).
shader_type spatial;
render_mode cull_disabled;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap;
uniform float alpha_cut : hint_range(0.0, 1.0) = 0.35;
uniform vec3 wind_dir = vec3(1.0, 0.0, 0.0);
uniform float wind_strength = 0.4;   // meters the outermost tips sway
uniform float wind_speed = 1.0;
uniform float gust_speed = 0.23;
uniform float flutter_strength = 0.03;
uniform float flutter_speed = 7.0;

void vertex() {
	float flutter = COLOR.r;
	float phase = COLOR.g * 6.2831853;
	float bend = COLOR.b;
	float t = TIME * wind_speed;
	float gust = 0.55 + 0.45 * sin(TIME * gust_speed + phase * 0.05);
	float sway = (0.6 + 0.4 * sin(t + phase * 0.3)) * gust;
	// Bend squared: the trunk barely moves, the tips most, and branches keep their length roughly.
	VERTEX += normalize(wind_dir) * wind_strength * bend * bend * sway;
	VERTEX += NORMAL * flutter * flutter_strength * sin(TIME * flutter_speed + phase);
}

void fragment() {
	vec4 c = texture(albedo_tex, UV);
	ALBEDO = c.rgb;
	ALPHA = c.a;
	ALPHA_SCISSOR_THRESHOLD = alpha_cut;
	NORMAL_MAP = texture(normal_tex, UV).rgb;
}
