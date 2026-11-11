# Canopy wind data

Pick **Export → Wind data → Layout**. Each layout stores wind in the vertex colors, so it works with GLB, FBX and OBJ.
These files are small sample shaders that read that data. Start from them and tune the numbers.

## Canopy layout (the default for Unity, Unreal and Godot)

| Channel | Holds | Range |
|---|---|---|
| R | Flutter: how much a point flutters. 0 at a leaf's stem, 1 at its tip. Branches are 0. | 0..1 |
| G | Phase: one random value per branch or leaf, so they don't all move together. | 0..1 |
| B | Bend: how much a point moves with the whole plant. 0 at the foot of the trunk, rising through each level to 1 at the outermost tips. | 0..1 |
| A | Your own color's alpha (unused by the wind). | |

The vertex RGB carries wind data now, not color. Take color from the textures.

## Godot layout

R is the sway (the same as Bend), as in Godot's "making trees" tutorial. G is the phase.

## Unreal: Pivot Painter 2

Choose **Unreal Pivot Painter 2 + Canopy colors**. Export also writes these two textures:

- `*_PivotPos_ParentIndex.exr`
- `*_XVector_XExtent.exr`

Each piece's pixel is in the second UV set. When you import them:

- Textures: no mips, nearest filtering, sRGB off.
- Mesh: turn off *Generate Lightmap UVs*, or Unreal overwrites the second UV set.

Then use Epic's Pivot Painter 2 material functions (*PivotPainter2FoliageShader*). The vertex colors carry the Canopy layout as well, so `CanopyWind_Unreal.hlsl` also works as a cheaper shader.

## The files

- `canopy_wind.gdshader`: a Godot 4 spatial shader with alpha cutout.
- `CanopyWind.hlsl`: a Unity Shader Graph *Custom Function* (File mode, name `CanopyWind`). Feed its output into the master stack's Vertex Position.
- `CanopyWind_Unreal.hlsl`: the body of a Material *Custom* node. Plug its output into World Position Offset.
