# v0.45.1 test list

Tick each one when it works on your PC and on the tablet. Notes on anything odd go next to it.

## Toolbar

- [ ] A folded group (one button with ▾) opens its list on a click. No more press-and-hold.

## Library and new files

- [ ] The first start (no saved plant) opens an empty plant with the **Library** in front.
- [ ] Open → **Library…** shows every sample with its thumbnail, name and "Free".
  - [ ] Tabs on top: All, Trees, Bushes, Flowers, Grass, Vines, Misc. Each shows its own plants.
  - [ ] **Request an asset** (bottom right) opens a new email to the request address.
- [ ] Clicking a sample opens it, with its own textures packed inside (Material editor shows them as pictures, such as "Stems grey.png").
- [ ] New gives an empty plant: no nodes, no materials, no textures.
- [ ] Texture pickers offer only "No texture", your own pictures and "Load image…". The old painted bark and leaf atlases no longer appear, except as the current value in an old file that uses one.
- [ ] PC app: the Library and samples open (they're read from disk there).

## Entity editor (Transform tool)

- [ ] The bar at the bottom has icon buttons: **Transform** (move, turn and scale in one), **Move**, **Rotate**, **Scale**, then **Entity** / **All entities**, then **Reset** and **Delete**.
  - [ ] Q, W, E and R switch between them and light the matching button.
- [ ] Transform shows arrows (move), rings (turn) and small boxes (scale) together, like Blender. The centre box scales evenly.
- [ ] Click a branch, leaf or mesh: the gizmo sits at its base. Only that entity moves, and what grows on it follows.
- [ ] The buttons on the bar work with a click, not only with Q, W, E and R.
- [ ] In Transform and Scale, the small boxes light up on hover and scale one axis. The centre box scales evenly.
- [ ] Shift-click adds or removes entities. Dragging a box on the plant picks the entities of the selected node inside it. Shift-drag adds to the pick.
- [ ] With several picked, move shifts them all; turn and scale work on each about its own base.
- [ ] **All entities** edits the node's Position, Rotation and Scale, so every entity of the node follows.
- [ ] **Reset** undoes the current tool's edit only: Move resets position, Rotate rotation, Scale scale. Transform resets all three. With All entities it resets the node's values.
- [ ] **Delete** (or the Delete key) removes the picked entities and what grows on them, not the node. Undo brings them back. With nothing picked, Delete still removes selected nodes.
  - [ ] All the other entities stay exactly where they were.
- [ ] A drag that starts on empty space in the 3D view (not only on the plant) draws the box.

## Atlas Bake and Scan Bake

- [ ] The toolbar and windows say **Atlas Bake** (was Bake) and **Scan Bake** (was Bake from scan).
- [ ] Scan Bake: import a scanned trunk and draw or place your own Spline inside it.
  - [ ] Selecting that Spline (in the graph or the 3D view) picks it in the panel.
  - [ ] The map size follows that Spline's own tube (its length and thickness); the scan's thickness is shown beside it.
- [ ] **Tileable along the length**, with a Blend band: the maps repeat without a seam along the length (around is seamless already).
- [ ] "Fit the Spline's thickness to the scan when applying" is off by default; your Spline keeps its shape.
- [ ] **Bake and apply** puts the scan's color and normal maps on that Spline.

## Age

- [ ] Age at Seedling (0.15): a small plant with a few leaves, not bare branches. Young (0.5) has more leaves; Mature is as built.

## Saving

- [ ] Settings → System → Saving → Textures has three choices:
  - [ ] **Inside the .canopy file**.
  - [ ] **Beside it, in a textures folder**: the PC app writes the .canopy and a textures folder next to it; a browser saves a .zip.
  - [ ] **Where they are in your files** (PC app): the file points at the pictures you loaded. Edit a picture, open the file again: the change shows. Moving the picture gives a message on opening.
- [ ] Every save keeps a small picture of the plant inside the .canopy (the "thumb" field).
- [ ] PC app: after starting it once, .canopy files show the Canopy icon in Explorer and open in Canopy on double-click, including while it is already open.

## Updates

- [ ] Settings → System → **Updates**: "Check for updates when Canopy starts" (on), "Install updates without asking" (off), **Check now**, and the version you have.
- [ ] Check now says "Canopy 0.46.0 is the newest version" while 0.46 is the latest release.
- [ ] When a newer release is out:
  - [ ] PC app: it asks, downloads (with %), closes, installs over itself and starts again. Your plant comes back.
  - [ ] Website: it asks to reload.
  - [ ] Android: it opens the new APK.

Known limits:
- Updating the PC app only works in the installed app, not from a dev run. It copies files over the old ones and never deletes, so the folder can keep a few unused old files.
- Android opens the APK download. Android asks you to install it yourself.
- Entity edits are stored per entity key. If you change a parent's count, an edit can land on a different entity.
