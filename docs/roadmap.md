# Canopy roadmap: age, season, health, growth, wind, ivy

Research notes (Nov 2026) and the proposed design. Vendor internals that are not publicly documented are marked as such.

## 1. Globals and drivers (foundation for everything below)

One small system instead of many new nodes:

- A **Globals** panel with `Age`, `Season`, `Health`, `Wind` sliders (0–1) plus user-added variables.
- Any parameter can **bind** to a global through the existing curve editor: `value = base × curve(global)`.
  Stored on the param as `{ src: 'Age', curve: [...] }`. This is what GrowFX calls "Affects" and what drives
  SpeedTree's timeline growth.
- Node groups / templates expose only the global sliders + seed, so a tablet user never needs to open the graph.

## 2. Age (seedling → mature → elder)

Per Spline/Placement node: `ageStart`, `ageEnd`. Local age `t = clamp((Age − ageStart) / (ageEnd − ageStart))`.

- Spline length grows from the tip (truncate arc length; don't scale the shape).
- Radius × t^0.7.
- Placement count ramps in **seed order**, so children appear stably instead of reshuffling.
- Child local age is offset by where it sits on the parent (base first, tip last) — the natural growth cascade.
- Elder (Age > ~0.85): more dead branches, thinner foliage, more gnarl — all through the same bindings.

**Auto Growth node (phase 2)** — rule-based grower (Grove / Plant Factory Growth / UE PVE Grower style):
iterations with bud life cycle, light from a voxel occlusion grid, phototropism, gravitropism, apical dominance
(delay laterals by distance from tip), shedding of shaded branches. Outputs splines into the existing Mesh nodes,
so all meshing, materials and export keep working.

Sources: thegrove3d.com; cgpress.org (PlantFactory 2016 Growth node: Age + Root inputs);
docs.unity3d.com/speedtree-modeler/manual/growth.html; UE 5.7 Procedural Vegetation Editor docs.

## 3. Season and Health

Season (SpeedTree's documented model, simplified):

- Per leaf `phase = Season + rand(seed) × spread` → colour from a gradient (summer → autumn → dead).
  Export it as vertex colour / UV attribute so engines can do it in the shader too.
- Leaf drop: `dropStart`, `dropSpread`; optional fallen leaves on the ground.
- Flowers / fruit: `[on, off]` season window on any Placement node (scale in/out).
- Snow: mask from normal·up and occlusion (vertex colour channel or a snow-cap offset mesh).

Health:

- `deadRatio` per level: chosen branches lose leaves, switch to bark material, curl/droop.
- `breakRatio`: truncate spline at random t and cap with a stub.
- Leaf damage: hole cutout variants from the atlas + chlorosis colour shift.
- Global Health lowers density and raises dead/break ratios through bindings.

## 4. Wind and animation export

Recommended order:

1. **Vertex colour + UV wind (default, all engines)** — Crytek-style layout:
   R = leaf/edge flutter, G = per-element phase, B = branch bend weight, A = baked AO;
   UV1 = (level / maxLevel, normalised height); UV2/UV3 = parent pivot position.
   Presets per target (Canopy, Godot R=sway, Custom remap) plus small reference shaders for Unity Shader Graph,
   Godot and an Unreal material function.
2. **Pivot Painter 2 export** for Unreal: pivot EXR (+ parent index in alpha), X-axis 8-bit texture, element-ID UV.
3. **Skeletal FBX/glTF**: a bone chain per branch to level N, leaves rigid-skinned. For UE 5.7 Nanite Dynamic Wind,
   a USD skeleton later (FBX does not carry its wind data).
4. VAT / Alembic: later (Alembic only for growth animation).

## 5. Ivy and vines

- Spline type **Crawl**: sticks to a target mesh (or the tree itself). Each step: nearest-surface query via a BVH,
  project onto the tangent plane, add adhesion + random + primary direction; gravity after it floats past a detach
  distance; random forks; outputs surface normals so leaves face out. (Thomas Luft's Ivy Generator, with BVH
  nearest-point instead of raycasts to fix its adhesion dropout.)
- Spline type **Hang**: catenary or verlet rope between one or two anchors with collision; high wind weight.

## 6. Game-artist pain points → Canopy features

| Pain point | Feature |
|---|---|
| Billboard/impostor quality, LOD pop | Octahedral impostor bake + dithered LOD fade |
| Overdraw in dense canopies | Cull interior cards + overdraw heat-map view |
| Cards waste fill-rate | Auto-fit card to alpha (4/6/8-vertex hull) |
| LOD authoring | LOD chain export with triangle budget |
| Fragile wind export | Documented channel presets; lightmap UV slot option |
| UE Nanite foliage | Geometry-leaf mode; skeletal/USD wind export |
| Foliage normals | Normals node: spherify / transfer from hull |
| Vertex AO | AO baked to vertex alpha |
| Atlases | Padding, dilation, thickness/translucency bakes |
| Collision | Auto capsules for trunk + level 1 (UCX_ for Unreal) |
| Root flares / junctions | Buttress modifier + merged junction mesh |
| Learning curve | Template presets with ~5 sliders |
