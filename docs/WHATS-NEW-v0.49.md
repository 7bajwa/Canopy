# What's new in v0.49

Everything changed since v0.48, as one checklist. Tick each item when it works on the PC and the tablet.

## Saving and backups

- [ ] **Save** writes over the open file; **Save As** (new toolbar button, Ctrl+Shift+S) picks a new name or place.
- [ ] PC: a **Documents/Canopy** folder appears with **Backups** and **Temp**; Save and Save As start there.
- [ ] Backups every **15 minutes** (Settings › System), only when the plant changed:
  - an unsaved plant: `Canopy-YYMMDD_HHMM.canopy`
  - a saved one: `<name>_YYMMDD_HHMM.canopy`
- [ ] Browser: the first backup asks **Download** or **Keep in browser**, and remembers it.
- [ ] Tablet: Save and backups land in the tablet's **Documents/Canopy**.
- [ ] The Backup button switches backups on and off.

## Welcome

- [ ] Opens at start: name, tagline, one-line description, New plant, Library, Open a file, Documentation, About Canopy, About Amanpreet.
- [ ] The credit (bottom right) opens github.com/7bajwa; **Show at start** turns it off.

## Windows, toolbar, panels

- [ ] Settings, Materials, Cutout editor, Library, Export, Welcome, Atlas Bake and all floating panels move by their title and resize from their corner; they reopen where you left them.
- [ ] The curve editor popup moves by its title; its width can be changed and is kept.
- [ ] **Settings › Interface › Reset the layout and scales** puts everything back.
- [ ] Toolbar: the wheel or a drag scrolls its icons; the corner at its end resizes it (sideways for length, down for up to 4 rows; double-click resets); the leaf folds it away and back.
- [ ] Navigation icons can't be lost off screen; on an upright tablet they dock on either side of their own half. The Delete icon is gone.
- [ ] The 3D view is on the left by default (Settings › Layout and graph).

## Settings, status bar, tooltips, shortcuts

- [ ] Tabs: Interface, Layout and graph, 3D view, Navigation, Toolbar, Shortcuts, Render, Wind, System. Notes are one line; the rest is in tooltips.
- [ ] Units: metres, centimetres or millimetres; or feet and inches in decimals or fractions (typing `5 1/2"` works).
- [ ] The status bar shows what is under the pointer (node, tab, value, variation, curve, button) and each setting you change; on/off and size in Interface.
- [ ] Tooltips: on/off and a delay (3 s by default).
- [ ] **Shortcuts** tab: every shortcut, click to change, Backspace clears, ↺ restores. New commands without a key (windows, layouts, next/previous node tab, fold the toolbar…).
- [ ] **Hover to open** (Navigation, off by default): node tabs, Settings tabs and folded toolbar lists open when the pointer rests on them.

## Variation

- [ ] Variation shows as a box: drag to change, tap for **Percent** or **Absolute**. Absolute works on values at 0.
- [ ] **System › New nodes start with** gives new nodes a starting variation (for example 10%).

## Scale figure

- [ ] Squirrel (25 cm) under 50 cm plants, baby, child, man, giraffe from 4.5 m, Sauroposeidon from 15 m.
- [ ] Settings › 3D view lists them with their heights; untick the ones you don't want.

## Placement and modifiers

- [ ] **Align with parent** (on by default): children line up like umbrella ribs, flat across a leaning parent.
- [ ] **On parent surface** (renamed).
- [ ] "Along <parent>" curves read the parent's own distribution; "This one" reads each generator's own 0–1 factor (point, line, ring, grid, urchin, spline, mesh, sprouts).
- [ ] Spline placement: Count instead of Density; curves run from Start to End.
- [ ] **Follow parent scale** on every placement.
- [ ] Spline modifiers: Start % and End %, and they work on local axes (Curl and Spiral can be world).
- [ ] Avoid: Bend (smooth turn) and Push again, besides Trim and Prune. Mesh Avoid Tilt keeps pieces on their joint.
- [ ] Reset, copy and paste on a curve act on every level of it.
- [ ] Texture Pack is a popup window that fits on tablets; the plant name field resizes, hides, and follows the saved file name.

## Docs and repo

- [ ] Docs home: About Canopy with a screenshot and links, and Working in Canopy sections.
- [ ] README: screenshots, download links for the latest Windows and Android builds.
