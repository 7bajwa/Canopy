// Canopy wind for Unreal: paste into a Material "Custom" node (Output Type: CMOT Float 3) and plug it into
// World Position Offset. Add these inputs to the node:
//   VC (Vertex Color), N (VertexNormalWS), T (Time), Dir (float3 world wind direction, Z up),
//   Strength (cm the outermost tips sway, e.g. 40), Speed (e.g. 1), Flutter (cm, e.g. 3), FlutterSpeed (e.g. 7)
// Vertex colors: R flutter, G phase, B bend (see README.md).
float phase = VC.g * 6.2831853;
float bend = VC.b;
float gust = 0.55 + 0.45 * sin(T * 0.23 + phase * 0.05);
float sway = (0.6 + 0.4 * sin(T * Speed + phase * 0.3)) * gust;
float3 o = normalize(Dir) * Strength * bend * bend * sway;
o += N * VC.r * Flutter * sin(T * FlutterSpeed + phase);
return o;
