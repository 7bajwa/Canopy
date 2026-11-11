# v0.44 test list

## Age & season (new button in the Variations group: a sprout with a sun)

- [ ] The panel floats and stays open. Drag a slider: the plant follows live.
- [ ] **Use Age, Season and Health** off: the plant is exactly as built.
- [ ] **Age**:
  - [ ] Seedling: only a short, thin trunk.
  - [ ] Young: branches appear from the base upward, and twigs and leaves come last.
  - [ ] Mature (1): as built.
  - [ ] Elder (above 1): thicker, and some branches wither (gray, bare).
  - [ ] Moving Age doesn't reshuffle the plant. It grows smoothly.
- [ ] **Season**:
  - [ ] Spring: small, light, fresh leaves.
  - [ ] Summer: as built.
  - [ ] Autumn: each leaf turns yellow, orange or red on its own day, and they start to fall.
  - [ ] Winter: bare.
  - [ ] Late in the year it turns back to spring.
- [ ] **Health**: lower withers whole branches (bark stays, leaves go), and thins and yellows the leaves.
- [ ] **Growth timing**: Level delay (how much later each level starts) and Base-to-tip delay (children near the tip start later).
- [ ] Undo and redo cover slider changes.
- [ ] Variations save Age, Season and Health with everything else. Save a Seedling, a Summer and a Winter, then click between them.
- [ ] Export (GLB, FBX, OBJ) writes the plant at its current age and season, including the leaf colors as vertex colors.

Known limits:
- Season colors multiply the leaf texture. Very dark or blue-ish leaf textures will turn less.
- Bark texture doesn't age, and fallen leaves aren't placed on the ground yet.

## Wind export

- [ ] Export → Wind data → **Layout**. Each layout fills the four channels for you:
  - [ ] **Canopy**: R flutter, G phase, B bend.
  - [ ] **Godot**: R sway, G phase.
  - [ ] **Unreal**: Pivot Painter 2 plus the Canopy colors (Pivot Painter gets ticked).
  - [ ] **No wind data**.
  - [ ] Changing a channel by hand still works.
- [ ] The new channel choice **Bend, trunk to tips**: 0 at the foot of the trunk, rising through each level to 1 at the outermost tips.
- [ ] The link "Sample wind shaders for Unity, Unreal and Godot" opens wind/README.md. The shaders sit beside it in the app's `wind` folder:
  - `canopy_wind.gdshader`
  - `CanopyWind.hlsl` (Unity Shader Graph Custom Function)
  - `CanopyWind_Unreal.hlsl` (Material Custom node to World Position Offset)
- [ ] In Godot: export a GLB with the Canopy layout and put `canopy_wind.gdshader` on it. Branches sway from the trunk out, each leaf flutters on its own phase.
- [ ] In Unity: wire the Custom Function into Vertex Position.
- [ ] In Unreal: try either the Custom node, or Pivot Painter 2 with Epic's foliage function. For Pivot Painter: no mips, nearest filtering, sRGB off on the textures, and no generated lightmap UVs.

Known limit: the vertex RGB carries wind data in these layouts, so leaf tints (season colors) aren't exported in vertex colors with them. Bake the colors into textures, or use Custom and keep a channel.
