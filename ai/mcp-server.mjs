#!/usr/bin/env node
// An MCP server (over stdin and stdout) that lets an AI client build plants in the Canopy PC app.
// Turn on Settings → Developer → "Let an AI assistant build plants here" in the app first; this server then
// talks to the app's local connection (127.0.0.1 only) with the token the app writes to its data folder.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const PORT = 47821;

function tokenFile() {
  if (process.env.CANOPY_TOKEN_FILE) return process.env.CANOPY_TOKEN_FILE;
  const home = homedir();
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Canopy', 'ai-token.txt');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Canopy', 'ai-token.txt');
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Canopy', 'ai-token.txt');
}

async function call(tool, args) {
  let token;
  try { token = readFileSync(tokenFile(), 'utf8').trim(); } catch {
    throw new Error('Canopy is not listening. Open the Canopy PC app and turn on Settings → Developer → "Let an AI assistant build plants here".');
  }
  const res = await fetch(`http://127.0.0.1:${PORT}/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Canopy-Token': token }, body: JSON.stringify({ tool, args }) });
  if (!res.ok) throw new Error(`Canopy answered ${res.status}.`);
  const reply = await res.json();
  if (!reply.ok) throw new Error(reply.error || 'Canopy could not do that.');
  return reply.result;
}

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const TOOLS = [
  { name: 'schema', app: 'schema', description: 'Every node type and its settings (key, label, type, default, unit, range, options, tab, hint), plus the materials in the file. Read this first.', inputSchema: obj({}) },
  { name: 'list_nodes', app: 'listNodes', description: 'The nodes of the current plant with their ids, types, names and parents.', inputSchema: obj({}) },
  { name: 'get_plant', app: 'getPlant', description: 'The whole current plant graph: nodes with all settings, links and plant settings.', inputSchema: obj({}) },
  { name: 'set_plant', app: 'setPlant', description: 'Replace the plant with a whole graph {nodes:[{id,type,name,params}], links:[{from,to,fromSock:"children",toSock:"parent"}]}.', inputSchema: obj({ graph: { type: 'object' }, name: { type: 'string' } }, ['graph']) },
  { name: 'add_node', app: 'addNode', description: 'Add a node (usually type "Spline" or "Mesh") with settings, optionally growing from a parent node id.', inputSchema: obj({ type: { type: 'string' }, name: { type: 'string' }, params: { type: 'object' }, parent: { type: 'string' } }, ['type']) },
  { name: 'set_params', app: 'setParams', description: 'Change settings of one node by id.', inputSchema: obj({ id: { type: 'string' }, params: { type: 'object' } }, ['id', 'params']) },
  { name: 'connect', app: 'connect', description: 'Make node "to" grow from node "from".', inputSchema: obj({ from: { type: 'string' }, to: { type: 'string' } }, ['from', 'to']) },
  { name: 'remove_node', app: 'removeNode', description: 'Delete a node by id.', inputSchema: obj({ id: { type: 'string' } }, ['id']) },
  { name: 'render', app: 'render', description: 'A PNG picture of the plant as it is now, to compare with what you are aiming for.', inputSchema: obj({ size: { type: 'number' } }) },
  { name: 'add_material', app: 'addMaterial', description: 'Make a plain material: color (#rrggbb), roughness 0..1, translucency 0..1 (light through leaves). Returns its id; give it to a node as params.material.', inputSchema: obj({ name: { type: 'string' }, color: { type: 'string' }, roughness: { type: 'number' }, translucency: { type: 'number' } }, ['color']) },
  { name: 'stats', app: 'stats', description: 'How big the plant is: lines, triangles, points and build time.', inputSchema: obj({}) },
];

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const answer = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return answer(id, { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'canopy', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized' || id === undefined) return null;
  if (method === 'ping') return answer(id, {});
  if (method === 'tools/list') return answer(id, { tools: TOOLS.map(({ app, ...t }) => t) });
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return fail(id, -32602, `Unknown tool ${params?.name}`);
    try {
      const result = await call(tool.app, params.arguments || {});
      if (tool.name === 'render' && result?.image) {
        return answer(id, { content: [{ type: 'image', data: result.image.split(',')[1], mimeType: 'image/png' }] });
      }
      return answer(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return answer(id, { content: [{ type: 'text', text: e.message }], isError: true });
    }
  }
  return fail(id, -32601, `Unknown method ${method}`);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line.replace(/^﻿/, '')); } catch { fail(null, -32700, 'Parse error'); return; }
  handle(msg).catch((e) => fail(msg.id ?? null, -32603, e.message));
});
