# v0.46 test list

Tick each one when it works. Notes on anything odd go next to it.

## Growth (a tree that grows itself)

- [ ] Toolbar → **Add a Growth tree** (the sprout icon): a Birch with leaves appears, with bark and leaf colors.
- [ ] Its Spline has a **Growth** tab. **Grow by itself** is on, with Geometry, Shadowing, Tropism and Bud placement settings.
- [ ] **Species…** sets Birch, Alder, Ash, Oak, Pine, Maple or Willow. Each looks different:
  - [ ] Birch and Alder are tall and open.
  - [ ] Oak is a wide dome.
  - [ ] Pine is tiered.
  - [ ] Willow hangs.
- [ ] **Years** grows it bigger.
- [ ] **Apical** above 0.5 gives a narrow cone; below 0.5 a wide crown (very sensitive).
- [ ] **Shedding threshold** higher gives a taller bare trunk.
- [ ] **Gravitropism angle**: 0 sends branches up, 90 level, above 90 weeping.
- [ ] **Phototropism** turns shoots toward open light.
- [ ] Leaves, Mesh nodes and wind work on the grown branches like on any Spline.
- [ ] **Max nodes** caps the size. The presets keep it near 6,000 nodes, with light tubes (8 sides).
- [ ] Known limits:
  - Growth does not yet react to other objects, cuts (pruning volumes) or age curves.
  - Leaves grow by density along every branch, not only on young wood.

## Trunk foot

- [ ] Tilt the trunk (its Angle, or Rotation in Transform): the foot stays on the ground on every side instead of lifting.

## Scan base blending

- [ ] Import a scan (or use a Mesh), turn on **Crop under branches** on it, and grow a Spline on it (Placement: Mesh) with **Blend into the base** on (Mesh tab).
  - [ ] Branches start inside the base, and the base's surface is cut where each one enters.
  - [ ] Known limit: the join is a cut, not a smooth fillet. A little gap can show where a branch narrows quickly.

## Distribution

- [ ] Placement → **Grid**: Columns, Rows, Spacing, Row spacing, Jitter and Stagger rows.
- [ ] Placement → Mesh → **On the mesh**:
  - [ ] **Random** (as before).
  - [ ] **Faces**: one per face.
  - [ ] **Vertices**: one per point.
  - [ ] **Layers**: rows around it from the bottom up, staggered like roof tiles.
- [ ] Mesh node, Sphere: **Profile** with its curve shapes the ball by height (egg, pear, bud).

## Modifiers

- [ ] New Spline modifier **Droop**: a level branch arches down from its base; longer lines sag more (Stiffness).
- [ ] Object reaction, Path reaction and Override steps are gone from the add list. Collide, Avoid intersections and the Spline's Segments cover them. Old files that use them still build.

## Wind view

- [ ] Shading → **Wind data** (the wind icon): red is flutter, green phase, blue bend, as exports carry it.
  - [ ] Turn wind on: it still sways, so each node's Wind tab can be tuned while watching.
  - [ ] Leaves keep their cutout shapes.

## Age & season

- [ ] **Fallen leaves**: dropped leaves lie on the ground under the plant, in autumn colors.
- [ ] **Snow**: up-facing surfaces whiten (in the view; not exported yet).

## LODs and impostors

- [ ] Export → **LODs**: 2 to 4 give name_LOD0, name_LOD1… in one zip, each lighter (fewer tube sides and segments, fewer but larger leaves).
- [ ] Each node's **LOD reduction %** (Mesh tab): 0 keeps that part the same in every LOD.
- [ ] Render group → **Impostor bake**: Views (4–16), Each view size, Upper half only.
  - [ ] It downloads a zip with an atlas of the plant from every direction, plus a JSON (layout, center, radius).
- [ ] Known limit: the cutout editor has no per-leaf LOD outline yet; LODs thin cutout leaves by count only.

## USD for Unreal 5

- [ ] Export → Format **USD (.usda)**: one .usda with the textures beside it in a zip.
- [ ] **Nanite assembly (Unreal 5.7+)**: repeated pieces become prototypes placed by a PointInstancer.
  - Use "Each piece on its own" and keep wind gradients off.
- [ ] In Unreal, import with **Interchange USD** (drag the .usda into the Content Browser), not the USD Stage actor.
  - [ ] See docs/ue5-export.md.
  - Not tried in Unreal yet; the files pass OpenUSD's own checks.
- [ ] FBX export of separate pieces: rotations now come in right when a piece turns on more than one axis.

## Explorer thumbnails (PC app)

- [ ] After starting the PC app once, saved .canopy files show the plant's picture as their thumbnail in Explorer.
- [ ] Files without a picture show the Canopy icon.
- [ ] Files Explorer showed before may keep the old icon until its thumbnail cache is cleared (Disk Cleanup → Thumbnails).

## Hidden AI control

- [ ] The AI connection only offers Spline and Mesh nodes, and the node reference link is gone from its settings.
