# v0.43 test list

Tick each one when it works on your PC and on the tablet. Notes on anything odd go next to it.

## Toolbar

- [ ] The old "Add and edit" group is now four groups with separators between them:
  - **Add nodes**: Spline, Mesh, Blend.
  - **Variations**: Random Seed, Save variation, Variations.
  - **Edit and draw**: Transform, Draw.
  - **Materials and cutouts**.
- [ ] Settings → Toolbar lists the four new groups. Folding, hiding and per-button toggles work for each one.
- [ ] The Render group has two new buttons: **Render settings** (the camera with a plus) and **Bake from scan**.

## Render

- [ ] The camera button renders straight away with the current render settings.
- [ ] Render settings opens a floating panel. You can drag it by its title, and it stays open while you orbit the plant.
- [ ] Width and Height are separate, and the ratio buttons (1:1, 4:3, 16:9, 9:16, 1:2) set the height.
- [ ] Camera has two options: **Frame the whole plant**, or **The current view** (keeps your framing).
- [ ] The Ground, Ground grid, Scale figure and Background options all show in the preview and in the saved picture.
- [ ] The filters (exposure, gamma, brightness, contrast, saturation, vibrance, temperature, tint, sharpen, vignette, grain) change the live preview.
  - [ ] Reset filters puts them all back.
- [ ] The transform gizmo, the draw preview and helper objects never appear in a render.

## Variations (was Presets)

- [ ] The panel floats and doesn't close on outside clicks. Change the view or the plant while it is open, then save or redraw.
- [ ] Change several node values (not only the seed), then Save current. Change things again, then click the thumbnail: every value comes back.
- [ ] ⤓ saves the plant as it is now into that variation. ↻ redraws its thumbnail. ✕ deletes it.
- [ ] Thumbnails use the current view and the render filters, never the ground grid, and keep the render's aspect.
- [ ] Old files with seed-only presets still open. Those tiles say "Seed only".
- [ ] Export all still works, both as a file for each and side by side.

## Transform (per copy)

- [ ] Turn on Transform, then click one branch, leaf or mesh copy in the 3D view. The gizmo sits at that copy's base.
- [ ] Move, turn and scale change only that copy, and its children follow it.
- [ ] "All copies" goes back to editing the node's Transform, so every copy follows.
- [ ] "Reset copy" removes that copy's own edit.
- [ ] Undo and redo work for copy edits.
- [ ] Known limit: copy edits are stored per copy key. If you change the parent's count, an edit can land on a different copy.

## Draw

- [ ] Pick a Spline (for example Branches), press Draw and draw from its parent (the trunk).
  - [ ] The new "Branches (drawn)" has the same mesh, material, modifiers and leaves.
  - [ ] It gets every child of Branches (twigs, leaves).
- [ ] Drawn lines are smooth and have as many rings as grown ones (resampled every 8 cm or finer).
- [ ] With a Mesh picked, Draw still draws on that mesh.

## Quads

- [ ] The wireframe shows quads with no diagonals: tubes, leaves, cutouts in quad mode, and mesh primitives. It matches what OBJ/FBX export writes.
- [ ] Cap tips and cutout fills stay triangles.
- [ ] Known limit: the Subdivide surface modifier still makes triangles.

## Cutouts and packer

- [ ] Packer: pick a piece, then **Edit vertices in 3D**. The cutout editor opens on that cutout, in the 3D tool.
- [ ] **Preserve UVs** on (the default): moving points changes the shape, and the texture stretches with it.
- [ ] Preserve UVs off: moving points also moves them on the picture, so the cut changes and the texture stays put.

## Bake from scan

- [ ] Import a scanned trunk (OBJ, FBX or GLB with its texture). Add or draw a Spline running up inside it.
- [ ] Bake from scan shows the unwrapped size for the chosen width (for example 1024 × 3400), and its ratio.
  - [ ] "Height to the nearest power of two" rounds it.
- [ ] **Fit Spline thickness to the scan** sets the Spline's thickness and its thickness curve along the length.
- [ ] **Bake and apply** makes a "<spline> scan" material (color and normal) and puts it on the Spline, laid once around and once along.
  - [ ] Use UV Offset U to line the seam up.
- [ ] **Bake and save the maps** downloads a zip with the color, height and normal maps.

## Files

- [ ] Settings → System → Saving → Textures:
  - [ ] **Packed inside the .canopy file** (the default) saves one file with every picture inside it.
  - [ ] **Beside it** saves a .zip holding the .canopy and a textures folder.
- [ ] Open… accepts that .zip, and all textures come back.
- [ ] Export has a new format, **Canopy plant (.canopy)**. "Pack textures" on gives one file, off gives the zip.

## Avoid

- [ ] Spline modifier **Avoid intersections**, Push mode:
  - [ ] Lines bow out smoothly around what they touch, at full strength, and come clear of the clearance distance.
  - [ ] Up to four passes run until nothing is still inside the clearance.
- [ ] Surface modifier **Avoid** on meshes:
  - [ ] It now sees across big triangles (cards, flat leaves, coarse tubes), not just their corners.
  - [ ] Touching points are pushed at least out to the clearance.

## Also

- [ ] On start, the graph frames below the top bar instead of under it.
