# v0.45 test list

Tick each one when it works. Notes on anything odd go next to it.

## Bake from scan

- [ ] Open Bake from scan, then import a mesh (or add a Mesh) while the panel is still open. It shows up in **Scan (Mesh)** straight away, and new Splines show up in **Spline**.

## Blender: season and wind node groups

Get the add-on again from Export → "Get the Blender add-on (Canopy Bridge)" and reinstall it (it is now 1.1.0 and needs Blender 4.0 or newer).

- [ ] Send to Blender: the plant comes in Z up, in its own collection, and the status line says "season and wind set up".
- [ ] Every Canopy object has a **Canopy Wind** geometry nodes modifier. Its **Plant size** is the same on all parts of one plant.
- [ ] Every material has a **Canopy Season** node group between the textures and the Principled BSDF (Base Color and Alpha).
- [ ] The Canopy tab (N panel) shows **Season**, **Health**, and **Wind**: Strength, Speed, Direction, Leaf flutter.
  - [ ] Season 0.25 is the plant as built. Around 0.5–0.65 leaves turn yellow, orange and red, each on its own, and start to drop. 0.8 is bare. Back near 1.0 they return.
  - [ ] Lower Health yellows leaves and thins them.
  - [ ] Press Play: branches lean and swing with the wind, more toward the tips; leaves flutter. Direction turns the wind around Z.
  - [ ] Right-click a slider → Insert Keyframe works (for example the season across an animation).
- [ ] With Age & Season on in Canopy, Season and Health in Blender start at Canopy's values.
- [ ] Export → FBX with Wind data → Layout **Blender**, then in Blender **Import Canopy FBX**: same setup as Send to Blender.
- [ ] **Set up selected** adds the setup to Canopy objects already in the scene (it skips objects without the CanopyBend UV set).
- [ ] Renders in EEVEE and Cycles; dropped leaves are see-through, not black.

Known limits:
- Leaves Canopy itself dropped (Age & Season on, autumn or winter) aren't in the file, so Blender can only drop more. Send in summer to have every leaf to work with.
- With "Each piece on its own", every piece sways around the plant's origin, not its own base.
- Blender's season colors multiply the leaf texture only. Canopy's vertex colors aren't used by the material.
