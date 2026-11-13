//! Explorer thumbnail provider for Canopy plant files (.canopy).
//! Reads the top-level "thumb" PNG data URL from the JSON and hands Explorer a 32-bit premultiplied DIB.
#![allow(non_snake_case)]

use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};

use base64::Engine;
use windows::core::{implement, IUnknown, Interface, Ref, Result, BOOL, GUID, HRESULT};
use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_POINTER, E_UNEXPECTED, S_FALSE, S_OK};
use windows::Win32::Graphics::Gdi::{CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl, IStream, STREAM_SEEK_SET};
use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl};
use windows::Win32::UI::Shell::{IThumbnailProvider, IThumbnailProvider_Impl, WTSAT_ARGB, WTS_ALPHATYPE};

/// {84B3F81B-EBD3-400E-8CD2-DFB8F1480510}
pub const CLSID_CANOPY_THUMBS: GUID = GUID::from_u128(0x84b3f81b_ebd3_400e_8cd2_dfb8f1480510);

const MAX_READ: usize = 64 << 20; // never read more than 64 MB of a file
const MAX_DIM: u32 = 4096; // reject absurd embedded images

static LIVE: AtomicIsize = AtomicIsize::new(0); // live objects + LockServer locks

#[implement(IThumbnailProvider, IInitializeWithStream)]
struct Provider {
    png: RefCell<Option<Vec<u8>>>,
}

impl Provider {
    fn new() -> Self {
        LIVE.fetch_add(1, Ordering::SeqCst);
        Self { png: RefCell::new(None) }
    }
}
impl Drop for Provider {
    fn drop(&mut self) {
        LIVE.fetch_sub(1, Ordering::SeqCst);
    }
}

impl IInitializeWithStream_Impl for Provider_Impl {
    fn Initialize(&self, pstream: Ref<IStream>, _grfmode: u32) -> Result<()> {
        let stream = pstream.ok()?;
        if self.png.borrow().is_some() {
            return Err(E_UNEXPECTED.into()); // already initialized
        }
        let _ = unsafe { stream.Seek(0, STREAM_SEEK_SET, None) }; // best effort; some streams start at 0 and refuse Seek
        let mut buf = Vec::with_capacity(256 << 10);
        let mut chunk = vec![0u8; 256 << 10];
        loop {
            let mut got = 0u32;
            let hr = unsafe { stream.Read(chunk.as_mut_ptr() as *mut c_void, chunk.len() as u32, Some(&mut got)) };
            hr.ok()?;
            buf.extend_from_slice(&chunk[..got as usize]);
            if let Some(png) = extract_thumb(&buf) {
                *self.png.borrow_mut() = Some(png);
                return Ok(());
            }
            if got == 0 || hr == S_FALSE || buf.len() >= MAX_READ {
                return Ok(()); // no thumb: GetThumbnail fails, Explorer shows the icon
            }
        }
    }
}

impl IThumbnailProvider_Impl for Provider_Impl {
    fn GetThumbnail(&self, cx: u32, phbmp: *mut HBITMAP, pdwalpha: *mut WTS_ALPHATYPE) -> Result<()> {
        if phbmp.is_null() || pdwalpha.is_null() {
            return Err(E_POINTER.into());
        }
        let guard = self.png.borrow();
        let png = guard.as_deref().ok_or(E_FAIL)?;
        let (w, h, rgba) = decode_png(png).ok_or(E_FAIL)?;
        let cx = cx.clamp(1, MAX_DIM);
        let (dw, dh) = if w >= h {
            (cx, (h as u64 * cx as u64 / w as u64).max(1) as u32)
        } else {
            ((w as u64 * cx as u64 / h as u64).max(1) as u32, cx)
        };
        let bgra = resize_premul_bgra(&rgba, w, h, dw, dh);
        let hbmp = make_dib(dw, dh, &bgra)?;
        unsafe {
            *phbmp = hbmp;
            *pdwalpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

/// Finds `"thumb" : "data:image/png;base64,<b64>"` and returns the decoded PNG bytes.
/// Returns None until the closing quote is in `buf`.
fn extract_thumb(buf: &[u8]) -> Option<Vec<u8>> {
    const KEY: &[u8] = b"\"thumb\"";
    const PREFIX: &[u8] = b"data:image/png;base64,";
    let ws = |b: &[u8], mut i: usize| {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1
        }
        i
    };
    let mut from = 0;
    while let Some(off) = find(&buf[from..], KEY) {
        let mut i = from + off + KEY.len();
        from = i;
        i = ws(buf, i);
        if buf.get(i) != Some(&b':') {
            continue;
        }
        i = ws(buf, i + 1);
        if buf.get(i) != Some(&b'"') {
            continue;
        }
        let s = &buf[i + 1..];
        if s.len() < PREFIX.len() || !s[..PREFIX.len()].eq_ignore_ascii_case(PREFIX) {
            continue;
        }
        let body = &s[PREFIX.len()..];
        let end = body.iter().position(|&c| c == b'"')?; // not fully read yet
        // JSON may escape '/' as "\/"; strip backslashes before decoding.
        let b64: Vec<u8> = body[..end].iter().copied().filter(|&c| c != b'\\').collect();
        return base64::engine::general_purpose::STANDARD.decode(b64).ok();
    }
    None
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Decodes any PNG to 8-bit RGBA.
fn decode_png(data: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let mut dec = png::Decoder::new(std::io::Cursor::new(data));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().ok()?;
    let (w, h) = (reader.info().width, reader.info().height);
    if w == 0 || h == 0 || w > MAX_DIM || h > MAX_DIM {
        return None;
    }
    let mut raw = vec![0u8; reader.output_buffer_size()?];
    let frame = reader.next_frame(&mut raw).ok()?;
    let raw = &raw[..frame.buffer_size()];
    let rgba: Vec<u8> = match frame.color_type {
        png::ColorType::Rgba => raw.to_vec(),
        png::ColorType::Rgb => raw.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => raw.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        png::ColorType::Grayscale => raw.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return None, // EXPAND turns palette into RGB(A)
    };
    (rgba.len() == (w * h * 4) as usize).then_some((w, h, rgba))
}

/// Resizes RGBA to dw x dh (box filter down, bilinear up) and returns premultiplied BGRA.
fn resize_premul_bgra(src: &[u8], w: u32, h: u32, dw: u32, dh: u32) -> Vec<u8> {
    // premultiply first so filtering doesn't bleed colour from transparent pixels
    let pm: Vec<[f32; 4]> = src
        .chunks_exact(4)
        .map(|p| {
            let a = p[3] as f32 / 255.0;
            [p[0] as f32 * a, p[1] as f32 * a, p[2] as f32 * a, p[3] as f32]
        })
        .collect();
    let at = |x: u32, y: u32| pm[(y * w + x) as usize];
    let (sx, sy) = (w as f32 / dw as f32, h as f32 / dh as f32);
    let q = |v: f32| v.round().clamp(0.0, 255.0) as u8;
    let mut out = Vec::with_capacity((dw * dh * 4) as usize);
    for y in 0..dh {
        for x in 0..dw {
            let mut acc = [0f32; 4];
            if sx > 1.0 || sy > 1.0 {
                let x0 = ((x as f32 * sx) as u32).min(w - 1);
                let y0 = ((y as f32 * sy) as u32).min(h - 1);
                let x1 = (((x + 1) as f32 * sx).ceil() as u32).min(w).max(x0 + 1);
                let y1 = (((y + 1) as f32 * sy).ceil() as u32).min(h).max(y0 + 1);
                for yy in y0..y1 {
                    for xx in x0..x1 {
                        let p = at(xx, yy);
                        for c in 0..4 {
                            acc[c] += p[c];
                        }
                    }
                }
                let n = ((x1 - x0) * (y1 - y0)) as f32;
                for c in &mut acc {
                    *c /= n;
                }
            } else {
                let fx = ((x as f32 + 0.5) * sx - 0.5).clamp(0.0, (w - 1) as f32);
                let fy = ((y as f32 + 0.5) * sy - 0.5).clamp(0.0, (h - 1) as f32);
                let (x0, y0) = (fx as u32, fy as u32);
                let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
                let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
                let (a, b, c2, d) = (at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1));
                for c in 0..4 {
                    let top = a[c] + (b[c] - a[c]) * tx;
                    let bot = c2[c] + (d[c] - c2[c]) * tx;
                    acc[c] = top + (bot - top) * ty;
                }
            }
            let a = q(acc[3]);
            out.extend_from_slice(&[q(acc[2]).min(a), q(acc[1]).min(a), q(acc[0]).min(a), a]);
        }
    }
    out
}

fn make_dib(w: u32, h: u32, bgra: &[u8]) -> Result<HBITMAP> {
    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w as i32,
            biHeight: -(h as i32), // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = std::ptr::null_mut();
    let hbmp = unsafe { CreateDIBSection(None, &bmi, DIB_RGB_COLORS, &mut bits, None, 0)? };
    if bits.is_null() {
        return Err(E_FAIL.into());
    }
    unsafe { std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len()) };
    Ok(hbmp)
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<IUnknown>, riid: *const GUID, ppv: *mut *mut c_void) -> Result<()> {
        if ppv.is_null() || riid.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *ppv = std::ptr::null_mut() };
        if outer.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let unk: IUnknown = Provider::new().into();
        unsafe { unk.query(riid, ppv).ok() }
    }
    fn LockServer(&self, lock: BOOL) -> Result<()> {
        LIVE.fetch_add(if lock.as_bool() { 1 } else { -1 }, Ordering::SeqCst);
        Ok(())
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(rclsid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT {
    if ppv.is_null() || rclsid.is_null() || riid.is_null() {
        return E_POINTER;
    }
    *ppv = std::ptr::null_mut();
    if *rclsid != CLSID_CANOPY_THUMBS {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let f: IClassFactory = Factory.into();
    f.query(riid, ppv)
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    if LIVE.load(Ordering::SeqCst) <= 0 {
        S_OK
    } else {
        S_FALSE
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extract() {
        let png = b"\x89PNG";
        let b64 = base64::engine::general_purpose::STANDARD.encode(png);
        let j = format!("{{\"name\":\"x\",\"thumbs\":1,\"thumb\" : \"data:image/png;base64,{b64}\",\"g\":{{}}}}");
        assert_eq!(extract_thumb(j.as_bytes()).as_deref(), Some(&png[..]));
        assert_eq!(extract_thumb(&j.as_bytes()[..j.len() - 12]), None); // cut before closing quote
        assert_eq!(extract_thumb(b"{\"name\":\"x\"}"), None);
    }
}
