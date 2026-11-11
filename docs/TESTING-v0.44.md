# v0.44 test list

## Age & season (new button in the Variations group: a sprout with a sun)

- [ ] The panel floats and stays open. Drag a slider: the plant follows live.
- [ ] **Use Age, Season and Health** off: the plant is exactly as built.
- [ ] **Age**:
  - [ ] Seedling: only a short, thin trunk.
  - [ ] Young: branches appear from the base upward, and twigs and leaves come last.
  - [ ] Mature (1): as built.
  - [ ] Elder (above 1): thicker, and some branches wither (gray, bare).
  - [ ] Moving Age doesn't reshuffle the plant. It grows smoothly.
- [ ] **Season**:
  - [ ] Spring: small, light, fresh leaves.
  - [ ] Summer: as built.
  - [ ] Autumn: each leaf turns yellow, orange or red on its own day, and they start to fall.
  - [ ] Winter: bare.
  - [ ] Late in the year it turns back to spring.
- [ ] **Health**: lower withers whole branches (bark stays, leaves go), and thins and yellows the leaves.
- [ ] **Growth timing**: Level delay (how much later each level starts) and Base-to-tip delay (children near the tip start later).
- [ ] Undo and redo cover slider changes.
- [ ] Variations save Age, Season and Health with everything else. Save a Seedling, a Summer and a Winter, then click between them.
- [ ] Export (GLB, FBX, OBJ) writes the plant at its current age and season, including the leaf colors as vertex colors.

Known limits:
- Season colors multiply the leaf texture. Very dark or blue-ish leaf textures will turn less.
- Bark texture doesn't age, and fallen leaves aren't placed on the ground yet.
