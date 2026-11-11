# Canopy Bridge for Blender: receives plants sent from the Canopy editor (Export > Send to Blender) and imports
# them into the open scene, with their textures, as quads where Canopy built quads. Each plant gets two node groups:
#   Canopy Season (shader): turns its leaves with the scene's Season and Health sliders, drops them in autumn.
#   Canopy Wind (geometry nodes modifier): sways branches and flutters leaves, from the scene's Wind sliders.
# Both read the CanopyWind (flutter, phase) and CanopyBend (bend, leaf) UV sets Canopy writes for Blender, so the
# plant keeps its own UVs and colors. A plant exported by hand works too: FBX with Wind data > Layout > Blender, then
# Import Canopy FBX in the Canopy tab.
#
# Install: Edit > Preferences > Add-ons > Install... and pick this file, then tick "Canopy Bridge".
# Use: in the 3D view's sidebar (N), Canopy tab, press Start listening. Then in Canopy press Send to Blender.
# It listens only on this computer (127.0.0.1), port 9787, and only ever imports the FBX it is sent.

bl_info = {
    "name": "Canopy Bridge",
    "author": "Canopy",
    "version": (1, 1, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Canopy",
    "description": "Import plants sent straight from the Canopy editor",
    "category": "Import-Export",
}

import math
import os
import queue
import re
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import bpy

PORT = 9787
MAX_BYTES = 1024 * 1024 * 1024  # a plant bigger than 1 GB is refused
inbox = queue.Queue()
state = {"server": None, "thread": None, "last": "Not listening"}


class Handler(BaseHTTPRequestHandler):
    # The editor runs in a browser, so it needs to be let in from its page (CORS, private network access).
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _reply(self, code, text):
        body = text.encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self._reply(200, "canopy-bridge")

    def do_POST(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if size <= 0 or size > MAX_BYTES:
            self._reply(400, "No file, or too large")
            return
        data = self.rfile.read(size)
        if not data.startswith(b"Kaydara FBX Binary"):
            self._reply(415, "Only Canopy's binary FBX is accepted")
            return
        q = parse_qs(urlparse(self.path).query)
        name = re.sub(r"[^\w\- ]+", "", q.get("name", ["Canopy"])[0])[:60] or "Canopy"
        life = {}
        for k in ("season", "health"):
            try:
                life[k] = min(1.0, max(0.0, float(q[k][0])))
            except (KeyError, ValueError):
                pass
        folder = os.path.join(tempfile.gettempdir(), "canopy_bridge")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name + ".fbx")
        with open(path, "wb") as f:
            f.write(data)
        inbox.put((name, path, life))
        self._reply(200, "ok")

    def log_message(self, *args):
        pass


# ---- Scene sliders: custom properties on the scene, so they can be keyframed (a season over the animation) ----

PROPS = {
    # name: (default, min, max, label, description)
    "canopy_season": (0.25, 0.0, 1.0, "Season", "0 spring, 0.25 summer (as built), 0.5 autumn, 0.75 winter"),
    "canopy_health": (1.0, 0.0, 1.0, "Health", "Lower yellows leaves and thins them out"),
    "canopy_wind_strength": (1.0, 0.0, 10.0, "Strength", "How hard the wind blows"),
    "canopy_wind_speed": (1.0, 0.0, 10.0, "Speed", "How fast it moves"),
    "canopy_wind_direction": (0.0, -360.0, 360.0, "Direction", "Where the wind blows to, in degrees around Z"),
    "canopy_wind_flutter": (1.0, 0.0, 5.0, "Leaf flutter", "How much the leaves flutter on their own"),
}


def ensure_props(scene, life=None):
    for k, (d, lo, hi, _, desc) in PROPS.items():
        if k not in scene.keys():
            scene[k] = d
            scene.id_properties_ui(k).update(min=lo, max=hi, soft_min=lo, soft_max=hi, description=desc)
    for k, v in (life or {}).items():
        scene["canopy_" + k] = v


# ---- Node building: a few helpers so the math reads like the formulas in Canopy's engine/life.js ----

class Builder:
    def __init__(self, tree):
        self.t = tree
        self.x = 0

    def node(self, kind, **attrs):
        n = self.t.nodes.new(kind)
        for k, v in attrs.items():
            setattr(n, k, v)
        n.location = (self.x, 0)
        self.x += 20
        return n

    def put(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.t.links.new(v, sock)
        else:
            sock.default_value = v

    def math(self, op, a, b=0.0):
        n = self.node("ShaderNodeMath", operation=op)
        self.put(n.inputs[0], a)
        self.put(n.inputs[1], b)
        return n.outputs[0]

    def smooth(self, lo, hi, x):
        n = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        self.put(n.inputs["Value"], x)
        self.put(n.inputs["From Min"], lo)
        self.put(n.inputs["From Max"], hi)
        return n.outputs["Result"]

    def vec(self, x, y, z):
        n = self.node("ShaderNodeCombineXYZ")
        for i, v in enumerate((x, y, z)):
            self.put(n.inputs[i], v)
        return n.outputs[0]

    def split(self, v):
        n = self.node("ShaderNodeSeparateXYZ")
        self.put(n.inputs[0], v)
        return n.outputs

    def vmath(self, op, a, b=None):
        n = self.node("ShaderNodeVectorMath", operation=op)
        self.put(n.inputs[0], a)
        if b is not None:
            self.put(n.inputs["Scale"] if op == "SCALE" else n.inputs[1], b)
        return n.outputs["Value"] if op in ("LENGTH", "DOT_PRODUCT") else n.outputs["Vector"]

    def mix(self, f, a, b):
        # a where f is 0, b where f is 1
        n = self.node("ShaderNodeMix", data_type="VECTOR")
        self.put(n.inputs["Factor"], f)
        self.put(n.inputs[4], a)
        self.put(n.inputs[5], b)
        return n.outputs[1]

    def uv(self, name):
        if isinstance(self.t, bpy.types.GeometryNodeTree):
            n = self.node("GeometryNodeInputNamedAttribute", data_type="FLOAT_VECTOR")
            n.inputs["Name"].default_value = name
            return self.split(n.outputs["Attribute"])
        n = self.node("ShaderNodeUVMap", uv_map=name)
        return self.split(n.outputs[0])


def _fresh(name, kind):
    t = bpy.data.node_groups.get(name)
    if t:
        return t, False
    return bpy.data.node_groups.new(name, kind), True


def season_group():
    t, new = _fresh("Canopy Season", "ShaderNodeTree")
    if not new:
        return t
    t.interface.new_socket("Color", in_out="INPUT", socket_type="NodeSocketColor").default_value = (1, 1, 1, 1)
    t.interface.new_socket("Alpha", in_out="INPUT", socket_type="NodeSocketFloat").default_value = 1.0
    t.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    t.interface.new_socket("Alpha", in_out="OUTPUT", socket_type="NodeSocketFloat")
    b = Builder(t)
    m = b.math
    gi = b.node("NodeGroupInput")
    go = b.node("NodeGroupOutput")

    def attr(name):
        return b.node("ShaderNodeAttribute", attribute_type="VIEW_LAYER", attribute_name=name).outputs["Fac"]
    s, h = attr("canopy_season"), attr("canopy_health")
    r = b.uv("CanopyWind")[1]
    leaf = b.uv("CanopyBend")[1]
    # Spring: lighter, yellower new leaves.
    k = m("SUBTRACT", 1.0, b.smooth(0.05, 0.18, s))
    spring = b.vec(m("ADD", 1.0, m("MULTIPLY", k, 0.25)), m("ADD", 1.0, m("MULTIPLY", k, 0.2)), m("SUBTRACT", 1.0, m("MULTIPLY", k, 0.2)))
    # Autumn: each leaf turns on its own day, toward yellow, orange or red.
    turn = m("MULTIPLY", b.smooth(m("ADD", 0.36, m("MULTIPLY", r, 0.1)), m("ADD", 0.48, m("MULTIPLY", r, 0.1)), s), m("LESS_THAN", s, 0.9))
    fall = b.mix(m("LESS_THAN", r, 0.75), (3.2, 0.4, 0.2), b.mix(m("LESS_THAN", r, 0.4), (3.0, 0.75, 0.15), (2.6, 1.15, 0.2)))
    c = b.mix(turn, spring, fall)
    # Poor health yellows and dulls.
    sick = m("MULTIPLY", m("SUBTRACT", 1.0, h), m("ADD", 0.4, m("MULTIPLY", r, 0.6)))
    c = b.vmath("MULTIPLY", c, b.vec(m("ADD", 1.0, m("MULTIPLY", sick, 0.6)), m("ADD", 1.0, m("MULTIPLY", sick, 0.25)), m("SUBTRACT", 1.0, m("MULTIPLY", sick, 0.7))))
    tinted = b.vmath("MULTIPLY", gi.outputs["Color"], c)
    b.put(go.inputs["Color"], b.mix(leaf, gi.outputs["Color"], tinted))
    # Leaves drop through autumn and come back in spring; poor health thins them.
    drop = m("MULTIPLY", b.smooth(0.5, 0.8, s), m("SUBTRACT", 1.0, b.smooth(0.96, 1.0, s)))
    gone = m("LESS_THAN", r, m("MULTIPLY", drop, m("ADD", 0.85, m("MULTIPLY", r, 0.3))))
    thin = m("LESS_THAN", m("FRACT", m("MULTIPLY", r, 7.31)), m("MULTIPLY", m("SUBTRACT", 1.0, h), 0.45))
    dead = m("MULTIPLY", m("MAXIMUM", gone, thin), leaf)
    b.put(go.inputs["Alpha"], m("MULTIPLY", gi.outputs["Alpha"], m("SUBTRACT", 1.0, dead)))
    return t


def _drive(node, scene, prop):
    d = node.outputs[0].driver_add("default_value").driver
    d.type = "AVERAGE"
    v = d.variables.new()
    v.type = "SINGLE_PROP"
    v.targets[0].id_type = "SCENE"
    v.targets[0].id = scene
    v.targets[0].data_path = '["%s"]' % prop


def wind_group(scene):
    t, new = _fresh("Canopy Wind", "GeometryNodeTree")
    if not new:
        return t
    t.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    t.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    ps = t.interface.new_socket("Plant size", in_out="INPUT", socket_type="NodeSocketFloat")
    ps.default_value, ps.min_value = 5.0, 0.001
    ps.description = "The plant's size: every part of one plant must have the same, so they sway together"
    b = Builder(t)
    m, vm = b.math, b.vmath
    gi = b.node("NodeGroupInput")
    go = b.node("NodeGroupOutput")
    val = {}
    for k in ("strength", "speed", "direction", "flutter"):
        n = b.node("ShaderNodeValue", name="Wind " + k, label="Wind " + k)
        n.outputs[0].default_value = PROPS["canopy_wind_" + k][0]
        _drive(n, scene, "canopy_wind_" + k)
        val[k] = n.outputs[0]
    fl, ph = b.uv("CanopyWind")[:2]
    bend, leaf = b.uv("CanopyBend")[:2]
    size = gi.outputs["Plant size"]  # moves scale with the plant
    sec = b.node("GeometryNodeInputSceneTime").outputs["Seconds"]
    T = m("MULTIPLY", sec, val["speed"])
    a = m("RADIANS", val["direction"])
    ca, sa = m("COSINE", a), m("SINE", a)
    wdir, side = b.vec(ca, sa, 0.0), b.vec(m("MULTIPLY", sa, -1.0), ca, 0.0)
    pos = b.node("GeometryNodeInputPosition").outputs[0]
    # A gust rolls across the plant; it leans with the wind and swings back a little.
    across = m("DIVIDE", vm("DOT_PRODUCT", pos, wdir), size)
    gust = m("ADD", m("ADD", m("MULTIPLY", m("SINE", m("SUBTRACT", m("MULTIPLY", T, 1.7), m("MULTIPLY", across, 4.0))), 0.35), m("MULTIPLY", m("SINE", m("MULTIPLY", T, 0.63)), 0.25)), 0.55)
    amp = m("MULTIPLY", m("MULTIPLY", val["strength"], size), m("MULTIPLY", bend, bend))
    lean = vm("SCALE", wdir, m("MULTIPLY", amp, m("MULTIPLY", gust, 0.025)))
    # Each branch swings across the wind on its own phase.
    wob = vm("SCALE", side, m("MULTIPLY", amp, m("MULTIPLY", m("SINE", m("ADD", m("MULTIPLY", T, 2.3), m("MULTIPLY", ph, 6.283))), 0.006)))
    # Leaves flutter along their normal, more toward their tips.
    fw = m("MULTIPLY", m("MULTIPLY", m("MULTIPLY", fl, leaf), m("MULTIPLY", val["flutter"], val["strength"])), m("MULTIPLY", size, 0.004))
    flut = vm("SCALE", b.node("GeometryNodeInputNormal").outputs[0], m("MULTIPLY", fw, m("SINE", m("ADD", m("MULTIPLY", T, 7.0), m("MULTIPLY", ph, 6.283)))))
    sp = b.node("GeometryNodeSetPosition")
    b.put(sp.inputs["Geometry"], gi.outputs[0])
    b.put(sp.inputs["Offset"], vm("ADD", vm("ADD", lean, wob), flut))
    b.put(go.inputs[0], sp.outputs[0])
    return t


def _patch_material(mat, group):
    if not mat or not mat.use_nodes or any(n.type == "GROUP" and n.node_tree == group for n in mat.node_tree.nodes):
        return
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = group
    g.location = (bsdf.location.x - 220, bsdf.location.y)
    for name, to in (("Color", "Base Color"), ("Alpha", "Alpha")):
        dst = bsdf.inputs[to]
        if dst.is_linked:
            nt.links.new(dst.links[0].from_socket, g.inputs[name])
        else:
            g.inputs[name].default_value = dst.default_value
        nt.links.new(g.outputs[name], dst)
    # Dropped leaves are see-through.
    for k, v in (("blend_method", "HASHED"), ("surface_render_method", "DITHERED")):
        try:
            setattr(mat, k, v)
        except (AttributeError, TypeError):
            pass


def _set_input(md, key, value):
    # Blender 5.2 keeps modifier inputs under .properties.inputs; before that they were ID properties.
    props = getattr(md, "properties", None)
    if props is not None and hasattr(props, "inputs"):
        getattr(props.inputs, key).value = value
    else:
        md[key] = value


def setup(objects, scene, life=None):
    """Adds the Canopy Season materials and the Canopy Wind modifier to the Canopy plants among objects."""
    plants = [o for o in objects if o.type == "MESH" and o.data.uv_layers.get("CanopyBend")]
    if not plants:
        return 0
    ensure_props(scene, life)
    sg, wg = season_group(), wind_group(scene)
    # One size for the whole plant (its bounds' diagonal), so leaves move with the branches they hang on.
    lo = [min(o.bound_box[i][a] * o.scale[a] for o in plants for i in range(8)) for a in range(3)]
    hi = [max(o.bound_box[i][a] * o.scale[a] for o in plants for i in range(8)) for a in range(3)]
    size = max(0.001, math.dist(lo, hi))
    key = next(i.identifier for i in wg.interface.items_tree if getattr(i, "name", "") == "Plant size")
    for o in plants:
        md = next((md for md in o.modifiers if md.type == "NODES" and md.node_group == wg), None)
        if not md:
            md = o.modifiers.new("Canopy Wind", "NODES")
            md.node_group = wg
        _set_input(md, key, size)
        for slot in o.material_slots:
            _patch_material(slot.material, sg)
    return len(plants)


def _import(name, path, life=None):
    # Blender's operators want a window to run in; a timer has none of its own.
    win = bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None
    before = set(bpy.data.objects)
    # Apply Transform: the mesh itself stands Z up, so the wind's directions read the same on every plant.
    if win:
        with bpy.context.temp_override(window=win):
            bpy.ops.import_scene.fbx(filepath=path, bake_space_transform=True)
    else:
        bpy.ops.import_scene.fbx(filepath=path, bake_space_transform=True)
    new = [o for o in bpy.data.objects if o not in before]
    # The plant comes in its own collection, so sending it again doesn't mix with the last one.
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    n = setup(new, bpy.context.scene, life)
    state["last"] = "Imported %s (%d objects%s)" % (name, len(new), ", season and wind set up" if n else "")


def _poll():
    while not inbox.empty():
        name, path, life = inbox.get()
        try:
            _import(name, path, life)
        except Exception as e:  # keep listening after a bad file
            state["last"] = "Could not import: %s" % e
    for area in getattr(bpy.context.screen, "areas", []) or []:
        if area.type == "VIEW_3D":
            area.tag_redraw()
    return 0.5 if state["server"] else None


def start():
    if state["server"]:
        return
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as e:
        state["last"] = "Port %d is busy: %s" % (PORT, e)
        return
    state["server"] = server
    state["thread"] = threading.Thread(target=server.serve_forever, daemon=True)
    state["thread"].start()
    state["last"] = "Listening on port %d" % PORT
    bpy.app.timers.register(_poll, first_interval=0.5)


def stop():
    server = state["server"]
    if not server:
        return
    state["server"] = None
    server.shutdown()
    server.server_close()
    state["last"] = "Not listening"


class CANOPY_OT_start(bpy.types.Operator):
    bl_idname = "canopy.start"
    bl_label = "Start listening"
    bl_description = "Receive plants sent from Canopy (Export > Send to Blender)"

    def execute(self, context):
        start()
        return {"FINISHED"}


class CANOPY_OT_stop(bpy.types.Operator):
    bl_idname = "canopy.stop"
    bl_label = "Stop listening"

    def execute(self, context):
        stop()
        return {"FINISHED"}


class CANOPY_OT_import(bpy.types.Operator):
    bl_idname = "canopy.import_fbx"
    bl_label = "Import Canopy FBX"
    bl_description = "Import an FBX exported from Canopy (Wind data > Layout > Blender) with season and wind set up"
    filepath: bpy.props.StringProperty(subtype="FILE_PATH")
    filter_glob: bpy.props.StringProperty(default="*.fbx", options={"HIDDEN"})

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        name = os.path.splitext(os.path.basename(self.filepath))[0]
        try:
            _import(name, self.filepath)
        except Exception as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        return {"FINISHED"}


class CANOPY_OT_setup(bpy.types.Operator):
    bl_idname = "canopy.setup_selected"
    bl_label = "Set up selected"
    bl_description = "Add the Canopy Season materials and Canopy Wind modifier to the selected Canopy plants"

    def execute(self, context):
        n = setup(context.selected_objects, context.scene)
        if not n:
            self.report({"WARNING"}, "No Canopy plant selected (it needs the CanopyBend UV set from Canopy)")
            return {"CANCELLED"}
        self.report({"INFO"}, "Set up %d objects" % n)
        return {"FINISHED"}


class CANOPY_PT_panel(bpy.types.Panel):
    bl_label = "Canopy"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Canopy"

    def draw(self, context):
        col = self.layout.column()
        if state["server"]:
            col.operator("canopy.stop", icon="PAUSE")
        else:
            col.operator("canopy.start", icon="PLAY")
        col.label(text=state["last"])
        col.label(text="In Canopy: Export > Send to Blender")
        col.separator()
        col.operator("canopy.import_fbx", icon="IMPORT")
        col.operator("canopy.setup_selected", icon="NODETREE")
        sc = context.scene
        if "canopy_season" not in sc.keys():
            return
        for title, keys in (("Season", ("canopy_season", "canopy_health")), ("Wind", ("canopy_wind_strength", "canopy_wind_speed", "canopy_wind_direction", "canopy_wind_flutter"))):
            box = self.layout.box()
            box.label(text=title)
            for k in keys:
                box.prop(sc, '["%s"]' % k, text=PROPS[k][3], slider=k != "canopy_wind_direction")
        self.layout.label(text="Right-click a slider to keyframe it.")


classes = (CANOPY_OT_start, CANOPY_OT_stop, CANOPY_OT_import, CANOPY_OT_setup, CANOPY_PT_panel)


def register():
    for c in classes:
        bpy.utils.register_class(c)


def unregister():
    stop()
    for c in reversed(classes):
        bpy.utils.unregister_class(c)
