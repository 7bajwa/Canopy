// Canopy wind for Unity Shader Graph: Custom Function node, File mode, Name "CanopyWind".
// Inputs: Position (Object), Normal (Object), Vertex Color, Time, WindDir (object space), Strength (units the
// outermost tips sway), Speed, Flutter, FlutterSpeed. Output: the new object-space position -> Vertex Position.
// Vertex colors: R flutter, G phase, B bend (see README.md).
void CanopyWind_float(float3 PositionOS, float3 NormalOS, float4 VertexColor, float Time, float3 WindDir,
                      float Strength, float Speed, float Flutter, float FlutterSpeed, out float3 Out)
{
    float flutter = VertexColor.r;
    float phase = VertexColor.g * 6.2831853;
    float bend = VertexColor.b;
    float gust = 0.55 + 0.45 * sin(Time * 0.23 + phase * 0.05);
    float sway = (0.6 + 0.4 * sin(Time * Speed + phase * 0.3)) * gust;
    float3 p = PositionOS + normalize(WindDir) * Strength * bend * bend * sway;
    p += NormalOS * flutter * Flutter * sin(Time * FlutterSpeed + phase);
    Out = p;
}

void CanopyWind_half(half3 PositionOS, half3 NormalOS, half4 VertexColor, half Time, half3 WindDir,
                     half Strength, half Speed, half Flutter, half FlutterSpeed, out half3 Out)
{
    float3 o;
    CanopyWind_float(PositionOS, NormalOS, VertexColor, Time, WindDir, Strength, Speed, Flutter, FlutterSpeed, o);
    Out = o;
}
