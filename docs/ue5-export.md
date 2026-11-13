# Canopy to Unreal Engine 5 through USD

Canopy can write a plant as a USDA (text USD) stage with `writeUsd` (`src/app/usd.js`). This page covers how Unreal
reads it, which settings to use, and what has and has not been tested.

## What the file contains

- Stage metadata: `upAxis = "Y"`, `metersPerUnit = 0.01` (centimetres, the editor's units), `defaultPrim` set to the plant.
  Canopy stays Y-up rather than converting to Z, because Unreal's USD importers read `upAxis` and `metersPerUnit` and
  convert on import. Keeping the editor's own frame means the same numbers as the OBJ/FBX exports, and other USD tools
  (Houdini, Blender, usdview) open the file the right way up.
- One `def Xform` root named after the plant. Each part is a `def Mesh`:
  - `points`, `faceVertexCounts`, `faceVertexIndices`. Quads are kept where `quadTri` marks them (the same
    `facesOf` the FBX/OBJ writers use), and everything else is triangles.
  - `normals`, `primvars:st` (UV0), `primvars:st1`, `st2`... for extra UV sets, all `vertex` interpolation.
    Unreal assigns texCoord2f primvars to UV channels in name order, so `st, st1, st2` keep Canopy's channel order.
    Blender-layout UV names (`uvNames`) are not used as primvar names, because a custom name would change that order.
  - `primvars:displayColor` (RGB) and `primvars:displayOpacity` (A) carry the vertex colours, including the wind
    channels from `colorA`. Unreal reads these as the mesh's vertex colour.
  - `doubleSided = 1` (like the FBX's `CullingOff`). Pass `doubleSided: false` per mesh to turn it off.
- Materials: one `UsdPreviewSurface` per material name under `/<Plant>/Materials`. Diffuse, normal and opacity maps
  are wired through `UsdUVTexture` + `UsdPrimvarReader_float2` (reading `st`). The normal map uses
  `scale (2,2,2,1)` / `bias (-1,-1,-1,0)` as the spec asks. An opacity map also sets `opacityThreshold` (default 0.5),
  which Unreal turns into a Masked material. Meshes bind with `material:binding`. A mesh whose faces choose
  materials (`polyMat`) gets one `GeomSubset` per material (family `materialBind`, `partition`).
- Instancing (`opts.instancing`): pieces whose geometry is identical (or that share a `proto` key) become one
  prototype under `/<Plant>/Instances/Prototypes`. A `def PointInstancer "Instances"` draws them with
  `protoIndices`, `positions`, `orientations` (`quath`) and `scales`. Pieces without copies stay plain meshes.
- Nanite Assembly (`opts.naniteAssembly`, which turns on instancing): the root gets `kind = "assembly"`,
  `apiSchemas = ["NaniteAssemblyRootAPI"]` and `unreal:naniteAssembly:meshType = "staticMesh"`.
- Nanite flag (`opts.nanite`): every Mesh gets `NaniteBuildSettingsAPI` with `unreal:nanite:enabled = 1`.
  This schema is in UE 5.8's USD plugin. Older versions ignore it; turn Nanite on in the import settings there.

## Which importer

| Path | Engine | Use |
|---|---|---|
| **Interchange USD import** (drag the `.usda` into the Content Browser, or *Import*) | Recent 5.x (check the feature flag below); the path Epic is developing | Making assets. **Required for Nanite Assemblies.** Epic says the legacy importer's assembly support is limited. |
| **USD Stage actor** (*Window > Virtual Production > USD Stage*, then open the file) | All 5.x | Live preview of the stage while iterating. It does not build Nanite assemblies. |
| Legacy *USD Stage importer* | All 5.x | No new features. It reads the 5.7 schemas but is not where fixes land. |

If drag-and-drop still uses the legacy importer, check the console variable `Interchange.FeatureFlags.Import.USD`. It must be `1` for Interchange to handle USD. Epic staff gave this in the forum thread linked below.

The Nanite Assembly schemas (`NaniteAssemblyRootAPI`, `NaniteAssemblyExternalRefAPI`, `NaniteAssemblySkelBindingAPI`)
first ship in UE 5.7. UE 5.6's `schema.usda` has none of them. The definitions this writer follows were read from
the UE 5.8 install at
`Engine/Plugins/Runtime/USDCore/Resources/UsdResources/<platform>/plugins/unreal/resources/unreal/schema.usda`.
The UE 5.8 engine headers show how Interchange builds an assembly:
- Meshes under the root that are **not** under a PointInstancer become the **base** mesh.
- PointInstancer prototypes become the **parts**, one assembly node per instance.
- Nested PointInstancers are traversed.
- An assembly cannot contain another assembly.

## Recommended workflow

### Plain static mesh (any UE 5.x)
1. In Canopy, export USD with grouping *by part* (or *single*) and instancing off.
2. Put the `.usda` and its texture PNGs in one folder.
3. Drag the `.usda` into the Content Browser and accept the Interchange USD pipeline.
4. In the static mesh pipeline settings, turn on **Build Nanite**. On 5.8, `opts.nanite` sets this per mesh.
5. Open the leaf material. Check that it is **Masked** and **Two Sided**.

### Nanite Assembly (UE 5.7+)
1. In Canopy, use grouping *instances* (`instancesOf`), with `naniteAssembly: true`.
2. The trunk and branches are the base mesh. Leaves and twigs that are true copies become parts.
3. Import with **Interchange** (drag into the Content Browser). Epic notes a few bogus warnings in the log are expected.
4. You should get one assembly static mesh, plus one static mesh per part.

There are three constraints, from Epic staff on the forums:
- **The base mesh must contain geometry.** A plant that is only instanced leaves, with no trunk, does not build an assembly. Epic suggests a hidden single triangle as a workaround, though it can raise degenerate-triangle errors.
- Assembly parts animate rigidly only. The assembly's own material slot has been reported to override part materials, and that report has no answer yet.
- Assemblies are experimental in 5.7/5.8. Epic says the schemas will stay backward compatible.

### Foliage and wind
- **Vertex colours**: Canopy's wind channels arrive through `displayColor` / `displayOpacity`, so a material reading
  *Vertex Color* sees them. Not yet checked: whether Unreal converts USD's linear colour floats to sRGB bytes
  (FBX stores them raw). If wind masks look too bright or dark after import, compare against the FBX import first.
- **Pivot Painter**: the pivot UVs Canopy writes for Pivot Painter (the `uvs` from `pivotUvs`) land in `st1`, so in UV
  channel 1. The Pivot Painter textures (`pivotTextures`) are separate EXR/PNG files. They are not part of the USD and
  are imported as textures the same way as for FBX.
- Per-piece wind data and instancing conflict. Instancing only shares pieces whose vertex colours and UVs are also
  identical. Wind colours or pivot UVs that differ per leaf therefore stop leaves from sharing a prototype. For an
  assembly, either drop per-vertex wind from the leaf parts and animate in the material by instance, or give copies a
  `proto` key so they share one prototype. A shared key keeps the first copy's colours and UVs.
- Skeletal (bending) assemblies use `meshType = "skeletalMesh"`, a SkelRoot base and `NaniteAssemblySkelBindingAPI`
  on the PointInstancer. This is how UE's Procedural Vegetation Editor (PVE) does wind on assemblies. Canopy does not
  write skeletons yet.
- Nanite foliage settings (5.8 `NaniteBuildSettingsAPI`): `unreal:nanite:shapePreservation = "Voxelize"` or
  `"PreserveArea"` helps thin leaves hold up at distance. The writer only sets `enabled` for now.

## Verified vs not

Verified:
- `npm test` covers the writer (`test/usd.test.js`): balanced braces, face and corner counts, materials bound, subsets, PointInstancer array lengths.
- A synthetic plant (a 120-quad trunk tube plus 50 instanced leaf quads) was opened with OpenUSD (`usd-core`, Python).
- In that check, every mesh passes `ValidateTopology`, and every material binding resolves.
- The PointInstancer computes 50 instance transforms that match the plain-mesh export within 0.001 (the `quath` precision).
- `UsdUtils.ComplianceChecker` reports no errors.
- Schema names and attributes were checked against the UE 5.8 `schema.usda` installed on this machine.

Not verified:
- **Not imported into Unreal yet.** No editor was reachable through the MCP bridge during this work.
- Whether the Interchange import builds the assembly from this exact file.
- Masked or two-sided material conversion.
- Normal map bias handling.
- Vertex colour precision in Unreal.

## Sources
- Epic, *Nanite Assemblies* (docs): https://dev.epicgames.com/documentation/unreal-engine/nanite-assemblies
- Epic, *Nanite Assemblies in USD, Part 1: Scene Structure*: https://forums.unrealengine.com/t/tutorial-nanite-assemblies-in-usd-part-1-scene-structure/2692208
- Forum, base mesh requirement, Interchange vs legacy: https://forums.unrealengine.com/t/required-structure-for-skeletal-mesh-nanite-assembly-using-usd-and-the-future-roadmap-for-nanite-foliage/2701126
- Forum, root `kind = "assembly"` + `NaniteAssemblyRootAPI` working: https://forums.unrealengine.com/t/need-help-with-nanite-assemblies/2693650
- Forum, ExternalRefAPI on 5.7.1, Interchange needed: https://forums.unrealengine.com/t/nanite-assembly-externalrefapi-broken-5-7-1/2699408
