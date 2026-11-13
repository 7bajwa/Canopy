# canopy_thumbs

Windows Explorer thumbnail handler for Canopy plant files (`.canopy`).

A COM in-proc server DLL (Rust, `windows` crate) exposing one class that implements
`IThumbnailProvider` + `IInitializeWithStream`. Explorer hands it a read-only stream of the file;
it scans the JSON for the top-level `"thumb"` field (`data:image/png;base64,...`), decodes the PNG,
scales it to fit `cx` (aspect kept; box filter down, bilinear up) and returns a 32-bit
premultiplied-alpha top-down DIB with `WTSAT_ARGB`. Files without `"thumb"` return `E_FAIL`, so
Explorer falls back to the normal icon. Reading stops as soon as the thumb's closing quote is seen
(capped at 64 MB), so large files cost only the first chunk in practice.

Exports: `DllGetClassObject`, `DllCanUnloadNow`. There is no `DllRegisterServer`; the app writes the
per-user registry keys itself (below).

## CLSID

```
{84B3F81B-EBD3-400E-8CD2-DFB8F1480510}
```

## Build

```
cd native/thumbs
cargo build --release
copy target\release\canopy_thumbs.dll ..\..\electron\canopy_thumbs.dll
```

Target `x86_64-pc-windows-msvc` (MSVC linker). Release profile is `opt-level = "z"`, LTO, strip,
`panic = "abort"`. The linker warning `LNK4104 ... should be PRIVATE` is harmless.

## Test without the registry

```
cargo test --release
cargo run --release --example harness -- <path\to\canopy_thumbs.dll> <file.canopy> <out.png> [size]
```

The harness `LoadLibrary`s the DLL, calls `DllGetClassObject` -> `IClassFactory::CreateInstance` ->
`IInitializeWithStream::Initialize` (stream from `SHCreateStreamOnFileEx`) -> `GetThumbnail(size)`,
and writes the HBITMAP to a PNG. Outputs are `*.out.png` (git-ignored).

## Registry keys (per user, HKCU)

| Key | Value |
| --- | --- |
| `HKCU\Software\Classes\CLSID\{84B3F81B-EBD3-400E-8CD2-DFB8F1480510}` | (default) = `Canopy Thumbnail Provider` |
| `HKCU\Software\Classes\CLSID\{84B3F81B-EBD3-400E-8CD2-DFB8F1480510}\InprocServer32` | (default) = full path to `canopy_thumbs.dll`; `ThreadingModel` = `Apartment` |
| `HKCU\Software\Classes\.canopy\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}` | (default) = `{84B3F81B-EBD3-400E-8CD2-DFB8F1480510}` |

Not needed:
- `DisableProcessIsolation`: do NOT set it. The handler is stream-based, so Explorer runs it
  isolated in a `dllhost.exe` surrogate; a crash there cannot take Explorer down.
- `Shell Extensions\Approved`: only enforced when the `EnforceShellExtensionSecurity` policy is on
  (it is off by default). If wanted anyway: `HKCU\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved`,
  value name `{84B3F81B-EBD3-400E-8CD2-DFB8F1480510}`, data `Canopy Thumbnail Provider`.

Notes:
- The DLL must be a real file on disk, not inside `app.asar` (use `asarUnpack` when packaging) and
  the registered path must point at the unpacked copy.
- While Explorer's surrogate holds the DLL it is locked; an updater that overwrites it may need to
  write to a new path and re-register, or retry after the surrogate exits.
- Explorer caches thumbnails. Files viewed before registration may keep the icon until the cache
  is cleared (Disk Cleanup > Thumbnails) or the file changes. A shell refresh
  (`SHChangeNotify(SHCNE_ASSOCCHANGED)`) or a new Explorer window picks up the new handler.

### Node snippet (electron main process)

```js
const { spawnSync } = require('node:child_process');
const CANOPY_THUMB_CLSID = '{84B3F81B-EBD3-400E-8CD2-DFB8F1480510}';
const THUMB_HANDLER_IID = '{e357fccd-a995-4576-b01f-234630154e96}';
const regAdd = (key, args) => spawnSync('reg', ['add', `HKCU\\Software\\Classes\\${key}`, ...args, '/f'], { windowsHide: true });
const reg = (key, value) => regAdd(key, ['/ve', '/d', value]);

function registerThumbnailHandler(dllPath) {
  reg(`CLSID\\${CANOPY_THUMB_CLSID}`, 'Canopy Thumbnail Provider');
  reg(`CLSID\\${CANOPY_THUMB_CLSID}\\InprocServer32`, dllPath);
  regAdd(`CLSID\\${CANOPY_THUMB_CLSID}\\InprocServer32`, ['/v', 'ThreadingModel', '/d', 'Apartment']);
  reg(`.canopy\\ShellEx\\${THUMB_HANDLER_IID}`, CANOPY_THUMB_CLSID);
}

// e.g. registerThumbnailHandler(path.join(__dirname, 'canopy_thumbs.dll').replace('app.asar', 'app.asar.unpacked'));
```

To unregister:

```js
const regDel = (key) => spawnSync('reg', ['delete', `HKCU\\Software\\Classes\\${key}`, '/f'], { windowsHide: true });
regDel(`.canopy\\ShellEx\\${THUMB_HANDLER_IID}`);
regDel(`CLSID\\${CANOPY_THUMB_CLSID}`);
```
