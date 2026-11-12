# Building plants in Canopy: a guide for an AI assistant

Canopy builds plants from a graph of nodes. Through the Canopy MCP server you can read every node type
(`schema`), build a plant node by node (`add_node`, `set_params`, `connect`) or all at once (`set_plant`), and
look at the result (`render`) to compare it with what you're aiming for. Lengths are in **centimetres**, angles
in **degrees**. The node reference (`docs/index.html` in the app) lists every setting.

## The model

- **Spline** — one part of a plant: a line, where its copies start, what wraps it, its material and its wind.
  Tabs: Spline (length, steps, direction modifiers), Placement, Mesh (tube, leaf blade or cutout leaf),
  Material, Wind.
- **Mesh** — a solid shape (sphere, rectangle, cone, disk or imported) placed as copies: fruit, pots, rocks, or a
  surface other parts grow on (grass on a disk).
- **Growth** — a node grows from its parent: `add_node({ type, parent })` or `connect({ from: parent, to: child })`.
  A trunk is a Spline with no parent; branches are a Spline whose parent is the trunk; and so on down to leaves.
- Any number setting can vary per copy (`vary: { key: amount }`, a percent, or degrees/cm for angles and offsets)
  and follow a curve (`curves: { key: { pts: [[0, 1, 's'], [1, 0.2, 's']] } }`, x along the line, y a factor).

## Key settings

| Setting | What it does | Typical |
|---|---|---|
| `length` | Line length (cm) | trunk 300–900, branch 100–350, twig 20–110, leaf 8–30, grass 30–80 |
| `steps` (Segment length) | Point spacing along the line (cm), when `segMode` is `relative` (the default); `segMode: 'absolute'` with `segCount` gives every line the same number of segments | 1/20 of the length |
| `xfSpace`, `posX/Y/Z`, `rotX/Y/Z`, `sclX/Y/Z` | Transform on the view gizmo's axes (X right, Y away from the front, Z up); `local` (default) uses each entity's own axes, Z the way it heads | 0 |
| `place` | Where copies start: `point`, `line`, `ring`, `urchin` (a ball of lines), `spline` (along the parent), `mesh` (on a Mesh), `sprouts` (on a cutout leaf's sprout points) | `spline` for anything on a branch |
| `count` | Copies for point/line/ring/mesh placement | |
| `density` | Copies per reference length (100 cm) along the parent | branches 1–3, twigs 4–10, leaves 20–40 |
| `start`, `end` | Part of the parent they grow on (%) | branches 30–97, leaves 8–100 |
| `pattern` | `spiral` (137.5°), `alternate`, `pairs`, `alternate pairs`, `whorl` | spiral for trees, alternate/pairs for many shrubs |
| `tilt` (Angle) | Pitch away from the parent | branches 45–80, leaves 40–60, grass 5–20 |
| `rotation` (Around parent) | Yaw around the parent line | |
| `roll` | Turn on its own axis | |
| `scale` | Size of each copy (%) | |
| `tipOn`, `tipTilt` | A copy at the parent's tip, so lines don't end cut | on for branches |
| `mods` | Direction modifiers on the line, by id: `{ noise: { strength, scale }, gravity: { vector, strength } }` (up `[0,1,0]` with 0.2–0.6 for branches seeking light; down `[0,-1,0]` 0.6–1.6 for drooping leaves). Other `Dir_` types from `schema` are added by type: `{ Dir_Random: { max: 30 } }` | |
| `meshType` | `tube` (bark), `leaf` (blade), `cutout` (leaf picture), `none` | |
| `radius` (Thickness) | Tube radius (cm); `autoRadius` follows the parent | trunk 10–30, branch 2–12, twig 0.3–3 |
| `width` | Blade half-width (cm); its curve is the leaf outline | grass 0.8–1.5, needle 0.3–0.5 |
| `angleAcross` (Fold), `incAcross` (Curl), `angleAlong` (Angle), `incAlong` (Bend), `leafTwist` | Leaf shape | fold 8–20 |
| `material` | A material id from `schema().materials`, or one you make with `add_material({ name, color, roughness, translucency })` | leaves: roughness 0.45, translucency 0.3 |
| `windPower`, `windSpeed`, `windFlutter` | How it sways | 100 is normal |

## Recipes (numbers from the built-in plants)

**Broadleaf tree.** Trunk: Spline, length 640, steps 26, radius 24, noise 22, gravity up 0.25; radius curve 1 → 0.1.
Branches: parent trunk, place `spline`, density 2.1, start 34, end 97, tilt 58 (vary 12), length 340 (curve 1 → 0.32
toward the top), autoRadius, gravity up 0.42. Twigs: parent branches, density 8, start 22, tilt 48, length 105,
radius 2.4, autoRadius. Leaves: parent twigs, density 34, start 8, tilt 52 (vary 16), length 22, meshType `cutout`,
fold 14, gravity 1.6 (down).

**Conifer.** Trunk length 900, radius 20, radius curve 1 → 0.04, bark `bark:dark`. Branches: density 7, start 14,
tilt 82, length 330 with a length curve 1 → 0.08 (long at the bottom), gravity 0.25 down. Side twigs: density 10,
pattern `alternate`, tilt 58, length 60, meshType `none`. Needles: density 40, pattern `pairs`, tilt 62, length 11,
meshType `leaf`, width 0.4.

**Shrub with berries.** Stems: count 9, tilt 26 (vary 16), length 190, radius 3.2, noise 8. Leaves on stems:
density 40, start 18, tilt 55, length 26, cutout. Berries: Mesh sphere radius 3, parent stems, density 3, start 45.

**Grass patch.** Ground: Mesh disk radius 150, `show: false`. Blades: Spline, parent the disk, place `mesh`, count
1400, spacing `random`, tilt 16 (vary 14), rotation vary 180, length 70 (vary 45), meshType `leaf`, width 1.3 with a
width curve 0.65 → 1 → 0.03, gravity down 0.9, color #9cc653 with a dark-to-light gradient along the length.

**Flowers.** Ground disk radius 90; Stems: place `mesh`, count 22, spacing `even`, minDist 12, length 75, radius 0.55.
Stem leaves: density 7, tilt 55, length 20, leaf width 2.4. Petals: parent stems, place `ring`, count 10, ringRadius
0.5, tilt 62, length 12, leaf width 3.4, color #f0659a. Center: Mesh sphere radius 2.2 at the stem tip.

**Palm.** Trunk length 600–900, radius 15, little taper, slight noise. Fronds: place `spline` with start 96, end 100,
pattern `whorl` (whorl 12–18), tilt 40–70, length 250–400 with gravity down 0.5–1. Leaflets: density 20–30, pattern
`pairs`, tilt 70, meshType `leaf`, width 2–3, length 40–70.

**Vine.** One long Spline (length 400–800) with strong noise (40–80) and gravity down, a thin tube (radius 0.8) and
leaves on it: density 10–20, pattern `alternate`, tilt 60, cutout leaves 8–14 cm.

## From a photo or a description

1. **Size.** Estimate the overall height and width. A person is about 180 cm, a door 200 cm.
2. **Structure.** Count the levels: trunk → branches → twigs → leaves (trees use 3–4 levels; grasses 1; shrubs 2–3).
   Note how many stems start at the ground and whether they split.
3. **Angles.** Estimate how steeply branches leave their parent (`tilt`), whether they droop or reach up
   (gravity), and how they're arranged (spiral, alternate, pairs, whorls).
4. **Density.** Count branches per metre of trunk, twigs per branch, leaves per twig; turn that into `density`
   (copies per 100 cm).
5. **Leaves.** Size, shape (narrow blade, broad cutout, needles), how they hang.
6. **Build top-down:** trunk first, render, then each level. After each level call `render` and compare the
   silhouette and density with the target; adjust one thing at a time.
7. **Materials.** Use the materials listed by `schema` (bark and leaf pictures); a leaf picture's cutouts are made
   in the cutout editor, and nodes pick them with `cutoutPick`.

Keep counts sensible: a whole tree should stay under about 400 000 triangles (`stats`).
