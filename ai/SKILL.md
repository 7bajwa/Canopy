---
name: canopy-plant-builder
description: Build or change plants in the Canopy plant editor through its MCP server, from a photo or a description. Use when asked to make a tree, shrub, grass, flowers or any plant in Canopy.
---

# Canopy plant builder

1. Call `schema` to see the node types, settings and materials. Lengths are cm, angles degrees.
2. Plan the structure from the photo or description: height, levels (trunk → branches → twigs → leaves),
   branch angles, arrangement (spiral, alternate, pairs, whorl), density per 100 cm, leaf size and kind.
3. Build top-down with `add_node` (type `Spline` for parts, `Mesh` for solid shapes; pass `parent` to grow from
   a node), or send a whole graph with `set_plant`.
4. After each level, `render` and compare with the target. Change one thing at a time with `set_params`.
5. Keep the plant under about 400 000 triangles (`stats`).

Key settings: `length`, `steps`, `place` (`spline` along a parent, `mesh` on a Mesh), `density`, `start`/`end`,
`pattern`, `tilt` (angle), `rotation` (around the parent), `roll`, `mods` (Noise, Gravity), `meshType`
(`tube`, `leaf`, `cutout`), `radius`, `autoRadius`, `width`, fold/curl/bend (`angleAcross`, `incAcross`, `incAlong`),
`material` (make one with `add_material`), `vary` ({ key: amount }) and `curves` ({ key: { pts: [[x, y]] } }) for variation,
`mods` ({ gravity: { vector, strength }, noise: { strength, scale } }).

Recipes and ranges: see `docs/ai-guide.md`.
