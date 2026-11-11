# Canopy Bridge for Blender: receives plants sent from the Canopy editor (Export > Send to Blender) and imports
# them into the open scene, with their textures, as quads where Canopy built quads.
#
# Install: Edit > Preferences > Add-ons > Install... and pick this file, then tick "Canopy Bridge".
# Use: in the 3D view's sidebar (N), Canopy tab, press Start listening. Then in Canopy press Send to Blender.
# It listens only on this computer (127.0.0.1), port 9787, and only ever imports the FBX it is sent.

bl_info = {
    "name": "Canopy Bridge",
    "author": "Canopy",
    "version": (1, 0, 0),
    "blender": (3, 3, 0),
    "location": "View3D > Sidebar > Canopy",
    "description": "Import plants sent straight from the Canopy editor",
    "category": "Import-Export",
}

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
        name = parse_qs(urlparse(self.path).query).get("name", ["Canopy"])[0]
        name = re.sub(r"[^\w\- ]+", "", name)[:60] or "Canopy"
        folder = os.path.join(tempfile.gettempdir(), "canopy_bridge")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name + ".fbx")
        with open(path, "wb") as f:
            f.write(data)
        inbox.put((name, path))
        self._reply(200, "ok")

    def log_message(self, *args):
        pass


def _import(name, path):
    # Blender's operators want a window to run in; a timer has none of its own.
    win = bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None
    before = set(bpy.data.objects)
    if win:
        with bpy.context.temp_override(window=win):
            bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    # The plant comes in its own collection, so sending it again doesn't mix with the last one.
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    state["last"] = "Imported %s (%d objects)" % (name, len(new))


def _poll():
    while not inbox.empty():
        name, path = inbox.get()
        try:
            _import(name, path)
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


classes = (CANOPY_OT_start, CANOPY_OT_stop, CANOPY_PT_panel)


def register():
    for c in classes:
        bpy.utils.register_class(c)


def unregister():
    stop()
    for c in reversed(classes):
        bpy.utils.unregister_class(c)
