# Canopy — a foliage maker

Canopy builds trees, shrubs, grass and flowers from a small graph of nodes, and shows the plant live in 3D right
behind the graph. It runs in the browser, installs as an app on Windows and Android tablets, and exports game-ready
meshes with their textures.

**Open it:** https://7bajwa.github.io/Canopy/ (works offline once opened; use the browser menu to install it).

## Video: a quick rundown

A walk through the settings and features:
**[Watch the Canopy rundown](https://transfer.it/t/88JmGi5jTDbZ)**

<!--
To play the video right here instead of linking out: download it from the link above, then on github.com open
this README, click Edit, and drag the .mp4 file into the editor. GitHub uploads it and puts a link like
https://github.com/user-attachments/assets/… on its own line, which shows as a player. Transfer links expire,
so the upload is the one that lasts.
-->

## One view for the tree and the graph

- The tree stands in front, the node graph sits behind it. Scroll over the tree to zoom the tree; scroll over empty
  space to zoom the graph. Pick a node and press **F** to frame it where the mouse is.
- **Right-drag** pans (tree or graph, whichever is under the mouse). **Middle-drag** revolves the 3D view.
- Layouts: **Overlay** (tree over graph), **Split** (side by side, drag the bar between), **Tree** or **Graph** only.
- Turn a tablet upright and the screen re-arranges by itself: the tree on top, the nodes below, the toolbar at the bottom.
- The toolbar is yours to arrange in Settings → Toolbar: switch single buttons off, hide a group, or fold it into one
  button that repeats the last thing picked from it (hold it for the rest). **Random Seed** sits beside the add buttons.
- The view gizmo shows the axes as Blender names them: **X** right, **Y** away from the front view, **Z** up.
  Click a ball to look straight down that axis.
- **Transform** tool: a gizmo on the picked Spline or Mesh node, at its base and on its own axes. Drag it to move
  (W), turn (E) or scale (R) every entity of that node; the bar under the view switches modes and removes the picked
  nodes on touch screens.
- **Draw** tool: draw splines straight into the 3D view. Strokes start on the picked node's branches and become a
  new Spline under it (or one on its own), with modifiers, meshes and children like any other.
- **Presets**: beside Random Seed, *Save preset* keeps the current seed with a thumbnail; *Presets* lists them to use,
  rename, delete, redraw their thumbnails, and export all of them (a file each, or side by side in one file).
- Undo remembers 80 steps; change it in Settings → System.

## Nodes

Right-click (or press Space) on the graph to add:

| Node | What it is |
|---|---|
| **Spline** | One complete part of a plant: the line, where it starts, what wraps it, its look and its wind. |
| **Mesh** | A sphere, box, cone, disk or imported object, placed like fruit or used as something to grow on. |
| **Blend** | Combines two values (add, multiply, mix…) to drive a setting. A, B and Blend each have their own variation and curve. |

Connect a node's **Children** to another's **Parent** to grow it from that part; a node can have several parents,
so one leaf node can grow on several branch nodes. Almost every value has a
**variation** icon (each copy different) and a **curve** icon (changes along the line, along any parent, or across the
whole plant).

## Spline settings, tab by tab

**Spline** — Length, **Segments** (Relative: a point every *Segment length*, so longer lines get more; Absolute: every
line gets the same *Segment count*), the wire color in the view, and a stack of modifiers: noise, gravity, random and
radial bends, spirals, collisions with the floor or objects, and **Avoid intersections** (push a line aside from lines
grown before it, trim it where it touches, or prune it).

**Placement** — Where lines start:
- *Point*, *Line*, *Ring*, *Urchin* (lines spread over a ball, like a sea urchin) at the origin or each parent's tip,
- *Spline* along the parent (spiral, alternate, pairs, whorls; density, start and end, the tip, where each tip leaf
  gets its own scale, angle and turn when they vary),
- *Mesh* over a Mesh's surface, *Sprouts* from the sprout points drawn on a cutout leaf.
- *Each entity*: angle, rotation, roll, scale, align to parent.
- *Transform*: position, rotation and scale per axis, in the entity's **Local** axes (X to its side, Z the way it
  heads) or in **World** axes (the gizmo's, Z up).

**Mesh** — What wraps the line. **Tube**, **Leaf** and **Cutout** are switches, so one line can carry a tube and
leaves together (a palm frond's stem and blades); the tube can then have its own material.
- *Tube*: thickness (with its curve), sides, **Relative thickness** with its **Factor** (never thicker than the parent
  times the factor), start/finish and rotation.
- *Caps*: a top cap (on by default) and an optional bottom cap, each with segments, height, a **profile** curve
  (rim on the left, middle on the right; flatten it for a flat cut) and a **border** (a ring of bark around the cut
  wood, for broken branches). Cap UVs continue the bark or lay a round patch of the texture.
- *Blend*: welds a branch into its parent, and a line with no parent into the floor (trunk flares) — height, spread,
  smoothness, buttress roots, root depth and turn, **offset** (leans the spread toward a branch's underside; 0 is even),
  collar, sink, quality, normal and texture cross-fade.
- *Leaf* and *Cutout*: blades along the line, or leaves cut from a texture atlas with their opacity — fold, curl,
  angle, bend, twist (its curve shapes where the leaf turns), 2-sided, soft canopy normals, and **Blend into parent**
  (the base of each leaf wraps onto its branch).
- *Mesh modifiers*: noise (with variation per piece and a curve from base to tip), displacement, inflate, wave, jitter, smooth, subdivide, ripple, **Thickness** (gives a leaf
  a back and sides; pinch the side columns only, with separate upper and lower profiles across the leaf) and
  **Avoid intersections** (push points out along their normals, or prune leaves and pieces that run into others).

**Material** — The scene material (color, texture, normal, roughness, opacity, translucency), color variation,
vertex colors (baked ambient occlusion, gradients along the length and by height) and UVs: tiling, offset, flip,
repeat by distance, twist, and **cap UVs** (continue the bark over the caps, or lay a round patch on them).

**Wind** — Sway power and speed, leaf flutter, and how the bend builds up from the base; presets for grass, stems,
bushes, trunks, branches, leaves and palms.

## Leaf cutouts from an atlas

Open **Edit cutouts** on a cutout Spline's material: auto-detect leaves from the texture's opacity, fit an optimized
outline mesh (rows and columns or triangles), add holes and sprout points, box-pick points (drag across the mesh,
or Shift-drag) and move them together, and shape a leaf in 3D (drag points, straighten, gridify, snap, reset, keep
the texture in place with *Preserve UVs*).

## Export

FBX, OBJ and glTF/GLB with their textures; baked branch atlases (albedo, normal, opacity and more) from
any camera; texture packing for game engines (pick which cutouts go in). Units are metric or imperial, with a scale
figure in the view. FBX and OBJ keep tubes and leaf blades as **quads**; only cutouts and the very tips of caps are
triangles (GLB is always triangles).

### Straight into Blender

1. Download the add-on: [canopy_blender.py](blender/canopy_blender.py) (also linked under the Export button).
2. In Blender: *Edit → Preferences → Add-ons → Install…*, pick the file, tick **Canopy Bridge**.
3. In the 3D view's sidebar (N), **Canopy** tab, press **Start listening**.
4. In Canopy: *Export → Send to Blender*. The plant arrives in its own collection, with its textures.

The add-on listens only on your own computer (127.0.0.1, port 9787) and only accepts Canopy's FBX.

## Building it yourself

The editor's source lives in the `app` folder of the project: `npm install`, then `npm run web:build` for this
website, `npm run pc:build` for Windows and `npm run android:build` for an Android tablet (see `BUILD.md` there).
