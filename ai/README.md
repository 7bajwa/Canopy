# Letting an AI assistant build plants in Canopy

1. Open the Canopy PC app and turn on **Settings → Developer → Let an AI assistant build plants here**.
   The app then listens on this computer only (127.0.0.1, port 47821) and writes a fresh access token to its
   data folder (`%APPDATA%\Canopy\ai-token.txt` on Windows). Turning the setting off closes it and deletes the token.
2. Register the MCP server with your MCP client. A typical client configuration:

```json
{
  "mcpServers": {
    "canopy": {
      "command": "node",
      "args": ["C:/path/to/app/ai/mcp-server.mjs"]
    }
  }
}
```

3. Give the assistant `ai/SKILL.md` (and `docs/ai-guide.md` for the details), then ask for a plant or show it a photo.

Tools: `schema`, `list_nodes`, `get_plant`, `set_plant`, `add_node`, `set_params`, `connect`, `remove_node`, `add_material`,
`render` (returns a picture), `stats`.

Safety: the connection only accepts requests from this computer that carry the token, every value is checked
against the node definitions before it reaches the plant, and nothing listens while the setting is off.
In the web version the same commands are on `window.canopyAI` in the browser console while the setting is on.
