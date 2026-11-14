# What's new since v0.45 (v0.45.1, v0.46, v0.47)

Everything added or changed after v0.45, as one checklist. Tick each when it works on the PC and the tablet.

## Library and files (0.45.1)

- [ ] **Library**: Open → Library… opens a window of plants with thumbnails.
  - [ ] Tabs: All, Trees, Bushes, Flowers, Grass, Vines, Misc.
  - [ ] Each card shows a name and "Free".
  - [ ] **Request an asset** (bottom right) opens an email.
  - [ ] Clicking a card opens it, with its own textures packed in. There are 28 examples.
- [ ] Your example files are in `app/public/samples`: each plant is a `.canopy` plus a `.png`. `index.json` sets name, category and price.
- [ ] The first start, and **New**, give an empty plant (no nodes, materials or textures). The first start opens the Library.
- [ ] Texture pickers no longer offer the built-in painted bark and leaves (an old file that uses one keeps it).
- [ ] Settings → System → Saving → Textures:
  - [ ] **Inside the .canopy file**.
  - [ ] **Beside it, in a textures folder**: the PC app writes the folder; a browser saves a .zip.
  - [ ] **Where they are in your files** (PC only): links to your pictures; a moved picture gives a message on opening.
- [ ] Every save keeps a small picture of the plant inside the file.
- [ ] PC: after one start, .canopy files have the Canopy icon, show the plant's picture as their Explorer thumbnail, and open in Canopy on double-click (also while it is open).
- [ ] Settings → System → **Updates**: check on start, install without asking, Check now.
  - [ ] PC: it downloads, installs over itself and restarts.
  - [ ] Website: it reloads.
  - [ ] Android: it opens the new APK.

## Toolbar and editing (0.45.1)

- [ ] Folded toolbar groups open their list on a click.
- [ ] **Atlas Bake** (was Bake) and **Scan Bake** (was Bake from scan).
- [ ] **Entity editor** (Transform):
  - [ ] Bar buttons work with clicks: Transform (all three gizmos), Move, Rotate, Scale. Q, W, E and R work too.
  - [ ] **Entity** / **All entities** switch between editing the picked branches and the whole node.
  - [ ] Scale boxes light up on hover and scale one axis.
  - [ ] Shift-click adds or removes entities; dragging a box anywhere in the 3D view picks the selected node's entities.
  - [ ] **Reset** undoes the current tool's edit; **Delete** (or the Delete key) removes picked entities and what grows on them.
  - [ ] The other entities never move when one is deleted. Undo brings it back.

## Scan Bake (0.45.1)

- [ ] It uses the Spline you select and sizes the maps from that Spline's tube.
- [ ] **Tileable along the length**, with a blend band.
- [ ] Fitting the Spline's thickness to the scan is off by default.

## Growth: a tree that grows itself (0.46, finished in 0.47)

- [ ] Toolbar → **Add a Growth tree** (sprout icon): a Birch with bark and leaf colors.
- [ ] The Spline's **Growth** tab is the **last tab**, with its own sprout icon.
- [ ] **Species…**: Birch, Alder, Ash, Oak, Pine, Maple, Willow, each a different shape.
- [ ] Geometry, Shadowing, Tropism and Bud placement settings change the tree as their hints say.
- [ ] **Cuts** (new in 0.47):
  - [ ] **Max height** stops shoots at a height.
  - [ ] **Max spread** keeps them within a distance of the trunk.
  - [ ] **Clear trunk** keeps side branches above a height.
- [ ] **Leaves on the last years** (new in 0.47): leaves and other children grow only on young wood, so old limbs stay bare.
- [ ] Leaves, meshes, wind and LODs work on grown branches.
- Still to come: age curves, other trees and objects shading it, a cache so scrubbing Years is instant.

## Blending (0.46, checked and fixed in 0.47)

- [ ] **Tube on tube** junctions blend as before.
- [ ] **Leaf blades and cutout leaves** with "Blend into parent" wrap their base onto the bark.
  - [ ] Since 0.47 the base also widens to part of the branch's thickness, so a pointed leaf still meets the bark with some width.
- [ ] **Tip tubes** (a branch's tip copy) carry the tube on:
  - [ ] There's no end cap between them.
  - [ ] The tip starts with the parent's thickness, on the parent's last ring point for point, so there is no seam.
  - [ ] It turns after a short stretch. Blend on or off, no pinch.
- [ ] **Tube on an imported mesh / scan**: "Crop under branches" on the Mesh plus "Blend into the base" on the Spline. Branches start inside, and the mesh is cut where they enter. Works with imported meshes and primitives.
- [ ] A tilted trunk keeps its whole foot on the ground.

## Placement and shapes (0.46)

- [ ] Placement → **Grid**: Columns, Rows, Spacing, Row spacing, Jitter, Stagger rows.
- [ ] Placement → Mesh → **On the mesh**:
  - [ ] Random.
  - [ ] Faces: one per face.
  - [ ] Vertices: one per point.
  - [ ] Layers: rows from the bottom up, like roof tiles.
- [ ] Mesh node, Sphere → **Profile** with its curve shapes the ball.
- [ ] New modifier **Droop**: sags under its own weight; longer branches sag more.
- [ ] Object reaction, Path reaction and Override steps are no longer offered (old files still build).

## Look and season (0.45.1–0.46)

- [ ] Age at **Seedling** is a small plant with a few leaves.
- [ ] **Fallen leaves**: dropped leaves lie under the plant in autumn colors.
- [ ] **Snow**: up-facing surfaces whiten in the view and, since 0.47, in exported vertex colors.
- [ ] Shading → **Wind data**: red flutter, green phase, blue bend. It still sways with wind on.

## Export and game LODs

- [ ] Export → **LODs**: LOD0 to LOD3 in one zip, each lighter. Each node has **LOD reduction %** (Mesh tab).
  - [ ] Since 0.47, from LOD2 each cutout leaf becomes one quad that keeps its picture (the alpha draws the outline).
- [ ] Render group → **Cards bake** (0.47, replaces the impostor bake):
  - [ ] **Single card**, **Cross (2 cards)**, **Triple (3 cards)**, **Billboard**.
  - [ ] Atlas 512, 1024 or 2048 (default 1024).
  - [ ] The zip has an FBX with the cards and both maps packed, a diffuse PNG with alpha, and a normal PNG.
  - [ ] The normal map is OpenGL style (+Y up); flip green for Unreal.
  - [ ] Each card's view holds the whole plant (no cropping).
- [ ] Export → Format **USD (.usda)** for Unreal 5, Omniverse and Houdini.
  - [ ] "Nanite assembly (Unreal 5.7+)" turns repeated pieces into prototypes on a PointInstancer.
  - [ ] Import in Unreal with Interchange (drag into the Content Browser). See docs/ue5-export.md.
- [ ] FBX "Each piece on its own": pieces turned on more than one axis now come in right.

## Hidden

- [ ] AI control stays hidden. When shown, it only offers Spline and Mesh nodes.

## Not verified by me

- Explorer thumbnails in real Explorer: the handler was tested directly, not through Explorer.
- The PC self-update: it needs a newer release than the one installed.
- The USD import in Unreal: no editor was connected.
