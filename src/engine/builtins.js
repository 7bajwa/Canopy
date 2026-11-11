// Settings built into Path and mesh nodes run as hidden modifiers and components,
// so they behave exactly like the separate nodes without cluttering the graph.
import { defaultParams } from '../graph/schema.js';

const hidden = (owner, tag, type, params) => ({ id: `${owner.id}#${tag}`, type, on: true, params: { ...defaultParams(type), ...params } });

export function inlineModifiers(n) {
  const P = n.params;
  const out = [];
  if (P.noiseOn) out.push(hidden(n, 'noise', 'Dir_Noise', { scale: P.noiseScale, strength: P.noiseStrength, rough: P.noiseRough }));
  if (P.randOn) out.push(hidden(n, 'rand', 'Dir_Random', { smoothing: P.randSmooth, min: P.randMin, max: P.randMax }));
  if (P.pullOn) out.push(hidden(n, 'pull', 'Dir_Vector', { vector: P.pullVector, strength: P.pullStrength }));
  return out;
}

export function inlineColors(b) {
  const P = b.params;
  const out = [];
  if (P.tintOn) out.push(hidden(b, 'tint', 'VCColorElements', { main: '#ffffff', target: P.tintColor, position: 50, posChaos: 100, weight: P.tintAmount, curves: P.tintCurve ? { weight: P.tintCurve } : undefined }));
  if (P.gradOn) out.push(hidden(b, 'grad', 'VCColorPaths', { blendMode: 'multiply', gradient: P.gradient }));
  if (P.gradHOn) out.push(hidden(b, 'gradH', 'VCColorPaths', { blendMode: 'multiply', gradient: P.gradH, byHeight: true }));
  return out;
}

export function inlineBlend(b) {
  const P = b.params;
  return hidden(b, 'blend', 'BranchBlend', {
    length: P.blendLength, flare: P.blendFlare, tension: P.blendTension, collar: P.blendCollar,
    sink: P.blendSink, rings: P.blendRings, shade: P.blendShade, textureBlend: P.blendTexture, minRatio: P.blendMinRatio,
    roots: P.blendRoots, rootDepth: P.blendRootDepth, rootTurn: P.blendRootTurn, offset: P.blendOffset,
  });
}
