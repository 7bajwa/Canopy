# What's new in v0.48

Everything changed since v0.47, as one checklist. Tick each item when it works on the PC and the tablet. Not pushed yet: this goes to GitHub once you confirm.

## Library and files

- [ ] Open menu reads **Canopy File…**, **Node File…**, **View Library**.
- [ ] Library tabs filter for real:
  - Trees 10, Bushes 4, Flowers 4, Grass 4, Vines 3, Misc 3.
  - Each category is now a subfolder of `public/samples` (Trees, Bushes, Flowers, Grass, Vines, Misc).
  - `index.json` is rebuilt on every build from the folders. It holds name, file, thumb, category and price, and keeps the prices you set.
  - To add a plant, drop its `.canopy` and `.png` into a category folder and build.
- [ ] Android: the app drawer shows the Canopy leaf icon, round and adaptive.
- [ ] `docs/market-plan.md`: the plan for the online library and market. It covers accounts, single assets and packs, payments, downloads and the Hostinger setup.

## 3D view

- [ ] Orbit and zoom work as in v0.47. The new orbit pivot and eased zoom were taken out because zooming in hung the app.
- [ ] The Shading menu reads Full PBR, **Colored**, **Solid AO**, **Vertex Color** (new icon), **Flat Shaded**, **Wiremesh**, **Splines**, as one list with no dividing line. Wireframe is gone.
  - [ ] **Splines** shows only the splines; picking any other shading brings the plant back.
  - [ ] **Colored** gives each node its own wire color. New nodes get a random wire color.
  - [ ] **Wiremesh** is a solid gray mesh without alpha, with the wireframe on top.
- [ ] **LOD** button (under the scale dial):
  - Pick LOD0..LODn to see it in the view. The menu stays open while you pick, add or remove LODs. While you are not at LOD0, the button turns green and the status line says "showing LOD2".
  - **Add a LOD** and **Remove** change how many LODs the file has (1–8, saved, undoable). Export makes that many.

## Entity editor

- [ ] The bar reads **Node** / **All** (was Entity / All entities).
- [ ] Settings → Navigation → **A box picks**: **What it touches** (default) or **Only what it fully covers**.

## Node graph and panel

- [ ] The **Mute** button sits left of the eye. A muted node makes nothing, but its children still grow, from the muted node's parent. Muted nodes have a striped purple title. Undo works.
- [ ] Wires snap to the nearest fitting socket within reach, and the target lights up.
- [ ] The same parent can't be connected twice to one node.
- [ ] Drag a connected input socket away to disconnect it; drop it on another socket to reconnect.
- [ ] A selected wire is deleted with Delete. On touch, a trash button appears next to "graph in front" while a node or wire is selected.
- [ ] Right-click a node opens its menu only on the title bar.
- [ ] Right-click a section heading in the panel: **Copy section**, **Paste section**, **Reset section**. These cover values only, not variation or curves.
- [ ] Shift while dragging a number gives fine steps (0.1×). Pressing Shift mid-drag no longer jumps.
- [ ] Modifier menus are in alphabetical order.

## Growth (now its own node)

- [ ] **Add a Growth tree** makes a **Growth** node with a leaf Spline under it. The Spline no longer has a Growth tab, and old files open as a Growth node.
- [ ] Trees no longer lean one way. A tie-break pulled every shoot toward −X/−Z; the average tree's centre went from 1.6 m off the trunk to about 0.1 m.
- [ ] Presets:
  - Birch, Alder, Ash, Oak, Maple and Willow have rounded or spreading crowns, wider than tall, with strong side limbs.
  - Pine stays a cone.
  - Ash is vase-shaped.
- [ ] New settings:
  - Lean and direction (only when set).
  - Droop.
  - Leader fades with age.
  - Longest shoot a year.
  - Trunk thickness (thinner by default).
  - Avoid meshes: Mesh nodes shade the space under them, and shoots slide along them.
- [ ] Age sets the years grown.
- [ ] Age and season settings:
  - Snow only in winter.
  - A few leaves (~6%) are already down in summer, following a season curve.
  - Leaf amount and growth amount have curves over age, plus leaf variation.

## Spline modifiers

- [ ] Renamed: Random, Vector, **Noise** (the old Noise direction), Deviation, **Warp** (was Spline direction), Radial, Spiral, Zigzag, Twist, **Avoid**, **Trim**.
- [ ] No longer offered (old files still build): Copy direction, Align children, Object slice, Vector orientation, Optimize steps, Start / end slice.
- [ ] **Curl** (new): Turns with curve (below 0 curls the other way), Tighten %, Axis, Direction and variation.
- [ ] **Trim** (new): Cut at %, Variation %, Lines cut %, with curves. Cuts keep the thickness at the cut, like a chopped branch. Children past the cut go away.
- [ ] Changes to existing modifiers:
  - **Droop**: Strength goes to 100. It sags by the weight beyond each point, so a strong droop hangs its tip straight down.
  - **Hard bend**: Smoothness (cm) rounds the corner.
  - **Zigzag**: Angle, angle variation and Axis.
  - **Spiral**: Axis.
  - **Deviation**: a local bump at each child, away from it, instead of one bend.
  - **Warp**: Shape B now bends across (Z).
  - **Radial**: bends over the whole length; the tip is no longer stiff.
  - **Avoid**: Against (same node / other nodes / everything). Push turns the line away at each hit and again if it hits again.
  - **Collide**: follows a mesh copy moved with the gizmo. Only the first copy is followed.

## Mesh modifiers

- [ ] **Subdivide** keeps quads. Only real triangles (cutouts, cap tips) stay triangles.
- [ ] **Thickness**:
  - Width scale is now **Thickness**, with variation and a curve.
  - Edge pinch rises gradually by default.
  - Profile, Both sides and Measure across are gone from new modifiers. Old files keep their look.
- [ ] **Merge** (new): welds points closer than a distance and keeps UV seams.
- [ ] **Remesh** (new): one continuous mesh from a node's parts, with UVs carried over and a quads option.
  - It is for blended branches, not thousands of leaves (3,000 cards took 2.6 s).
  - It doesn't merge across nodes yet.
- [ ] **Avoid**: new **Tilt** mode, the default for new modifiers. Leaf cards turn about their base, or slide, by the smallest move that clears the others. Card width and thickness count.
- [ ] **LOD** (new, on Spline and Mesh nodes): Reduction % with a per-LOD curve, what it reduces (segments / sides / leaf count), and Cards from LOD. When it is present, it replaces the old LOD reduction %.
- [ ] **Project** (new): shrink-wraps the tube onto a Mesh node.
  - Nearest surface or along normal.
  - Offset, strength with curve, falloff, max distance, which parts.

## Tubes and blending

- [ ] There is no gap along the tube's side seam or at the caps; vertices are welded.
- [ ] A tip tube shares the parent's last ring exactly (positions and normals). Tip on turns both caps off; tip off keeps the node's cap setting.
- [ ] The UV seam runs along the upper side of each tube.
  - Old files: the bark texture turns around the tube a little.
- [ ] Blended junctions take their normals from the parent surface under each point, with a softer hand-over, so the joint doesn't show.
- [ ] **Start on parent surface** (Spline tab, on for new nodes, off for old files): children start on the bark, not from the center line. The blend accounts for it.
- [ ] With blend on, the trunk foot stands on the floor or on the mesh it grows from, over the blend height. With blend off, it is as before.
- [ ] Tubes on a Mesh node now blend into it.

## UVs

- [ ] UV section:
  - **Angle** turns the UVs (tubes, leaves, cutouts).
  - **Fit**: None / U (one tile around) / V (once along the length).
  - **Tile from / to**: below "from" the texture is used once, then the from–to band repeats. Use it for a unique base with a tiling top.
- [ ] **UV editor** (button in the UV section and in the Materials toolbar group): a floating panel that shows the node's UV box over its texture.
  - A UV grid is always shown: tile lines, finer lines inside 0..1, faint outside.
  - The real UVs of the built mesh are drawn as a thin blue wireframe: tubes, leaf cards (also when reshaped by curves or Match leaf shape) and cutout leaves. Dragging the box moves them live.
  - Without a material or texture a checker shows, and the UVs can still be edited.
  - Drag to move, corner to scale, outer dot to turn. The fields are live and undoable.
  - For cutout nodes: Angle, plus "Edit cutouts…".
- [ ] The packer button is now **Texture Pack**. It takes tubes too. Each tube is a box one UV tile in size: move, turn and scale it. Pack remaps its Tile, Offset and Angle and switches it to the packed material.
  - Exact for square sheets.
  - A tube repeats cleanly along V only when its box spans the sheet.
- [ ] Cutout editor **LOD ▾** menu:
  - ▶ stores the current cutout as that LOD.
  - Click a LOD's name to show its version and edit it. LOD0 is kept meanwhile. Click LOD0 to go back; closing the editor also goes back to LOD0.
  - A LOD with no version uses the same cutout. Showing it starts a copy you can edit.

## Placement

- [ ] **Vertex** mode lines children up with the vertex normals. It was always straight up before.
- [ ] **Layers**:
  - Per layer, plus Axis X / Y / Z.
  - Rows are found by casting toward the axis, so rows sit on the real mesh.
  - Old Layers files can look different.

## Scan Bake

- [ ] Two dropdowns at the top: **Spline** and **High-poly mesh**.
- [ ] **Fit** adds (or reuses) a Project modifier on the spline, targeting the picked mesh. It fits the thickness too when ticked.
- [ ] Bakes color, height, normal, AO, roughness and subsurface, with the same Maps and Export lists as the Bake panel. Tileable still works.

## Export and cards

- [ ] Formats read **GLB, FBX, OBJ, USD, Canopy, Blender**. With Blender picked, the button says **Send to Blender**.
- [ ] Pack textures **on**:
  - Textures go inside GLB and FBX.
  - OBJ comes as a zip.
  - Blender is always packed.
- [ ] Pack textures **off**:
  - GLB becomes `.gltf` + `.bin` + `textures/`.
  - Other formats get a `textures/` folder.
  - Everything comes zipped.
- [ ] **Each piece on its own** keeps the hierarchy: leaves under their branch, branches under the trunk (FBX and GLB outliner).
- [ ] **LODs** exports `doc.lods` levels. **Billboard**: None, last LOD (default), or an earlier LOD. That LOD is baked as one card into the zip; later LODs are left out.
- [ ] Cards bake:
  - Single card was removed (it was the same as Billboard).
  - New **Views sprite**: 4, 8 or 16 frames around the plant in one atlas on one card, Level or Isometric 30°, plus a `_sprite.json`.
  - Normals are **DirectX** by default; OpenGL is an option.

## Round 2 fixes

- [ ] **Zoom no longer hangs:** orbit and zoom are back to the v0.47 way.
- [ ] Dragging a number or the view with the mouse no longer stops at the screen edge: the pointer is locked while you drag. Touch and pen work as before.
- [ ] Every new node, duplicate and pasted node gets a random wire color. Imported Node Files keep theirs.
- [ ] The color popup has a dice button (random color) and a system color picker button, after the color sample and before HEX. They show on every color box.
- [ ] Shading menu: Wireframe is gone (a saved Wireframe opens as Wiremesh).
- [ ] Cutout editor:
  - Works on a blank sheet when the material has no texture: draw cutouts by hand. Auto detect is off then.
  - The material panel shows Cutouts without a texture too. Make cutouts is greyed out, Edit cutouts works.
  - A ⟳ button next to Auto detect redoes detection for the selected cutout only, with its own settings popup. With a LOD shown, it writes into that LOD. Undo works.
  - Undo now matches the other bar buttons and sits with Delete all, after a separator.
- [ ] Snapping icons in the bar of the cutout editor, UV editor and Texture Pack: move (grid), turn (15°), scale (10%). Hold Ctrl to flip snapping while dragging. Each editor remembers its toggles.
- [ ] UV editor: a cutout leaf shows only **Edit cutouts…**; plain leaf cards keep full UV editing.
- [ ] Tube UVs: new **Even texel size** (UV section, on for new nodes). The trunk wraps the texture once around (U 0..1) and repeats it along V at the same scale; thinner branches take a smaller U share so the bark is the same size everywhere. Old files keep the old look (setting off).
  - On branches U no longer wraps a whole tile, so a texture seam can show along them.
- [ ] Seam gap: Smooth, Noise, Inflate, Wave, Jitter, Ripple, Displace and Thickness move both copies of a seam point together, so the UV seam no longer opens.
- [ ] **Deviation** now kinks the line toward each child. It also works when the child's angle is 0. "From child" is off by default, so Angle is used.
  - Old files using Deviation bend the other way now (this is the fix).
- [ ] Leaf cutouts:
  - In "Use cutouts", ◀ ▶ buttons on each thumb change the order. The order is saved and undoable.
  - **Spread**: Random (default) or **By curve**. With By curve, a Pick curve maps base→tip of the parent to first→last in the list, and Variation % shifts the pick. Use it to put big, old leaves low and fresh ones on top.
- [ ] **Crumple** (new mesh modifier): folds and curls leaf cards from the corners like dried leaves.
  - Settings: Amount (variation, curve base→tip), Corner curl, Wrinkles, Wrinkle size, Seed.
  - The stem end stays put.
  - Folds follow the mesh detail: add Subdivide before it for finer folds.

## Known limits

- USD left as it was (didn't work in Unreal).
- In the PC app, unpacked exports still come as a zip, not a real folder.
- The transform gizmo and AI bridge don't know the Growth node yet.
- Imported meshes on a Mesh node aren't reduced by LOD.
- The tip tube's texture restarts at V 0 (the vertices are welded).
