//! Loads the built DLL like Explorer would (no registry) and dumps GetThumbnail to a PNG.
//! Usage: cargo run --release --example harness -- <dll> <file.canopy> <out.png> [size]
use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;

use windows::core::{Interface, GUID, HRESULT, PCWSTR};
use windows::Win32::Graphics::Gdi::{DeleteObject, GetObjectW, BITMAP, HBITMAP};
use windows::Win32::System::Com::{CoInitializeEx, IClassFactory, COINIT_APARTMENTTHREADED, STGM_READ};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::UI::Shell::PropertiesSystem::IInitializeWithStream;
use windows::Win32::UI::Shell::{IThumbnailProvider, SHCreateStreamOnFileEx, WTS_ALPHATYPE};

const CLSID: GUID = GUID::from_u128(0x84b3f81b_ebd3_400e_8cd2_dfb8f1480510);

fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain([0]).collect()
}

fn main() -> windows::core::Result<()> {
    let a: Vec<String> = std::env::args().collect();
    let (dll, file, out) = (&a[1], &a[2], &a[3]);
    let size: u32 = a.get(4).map_or(256, |s| s.parse().unwrap());
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let lib = LoadLibraryW(PCWSTR(wide(dll).as_ptr()))?;
        type GetCo = unsafe extern "system" fn(*const GUID, *const GUID, *mut *mut c_void) -> HRESULT;
        type CanUnload = unsafe extern "system" fn() -> HRESULT;
        let get: GetCo = std::mem::transmute(GetProcAddress(lib, windows::core::s!("DllGetClassObject")).expect("no DllGetClassObject"));
        let can_unload: CanUnload = std::mem::transmute(GetProcAddress(lib, windows::core::s!("DllCanUnloadNow")).expect("no DllCanUnloadNow"));

        let bad = GUID::from_u128(1);
        let mut p = std::ptr::null_mut();
        println!("wrong CLSID -> {:?}", get(&bad, &IClassFactory::IID, &mut p));

        get(&CLSID, &IClassFactory::IID, &mut p).ok()?;
        let cf = IClassFactory::from_raw(p);
        let init: IInitializeWithStream = cf.CreateInstance(None)?;
        let stream = SHCreateStreamOnFileEx(PCWSTR(wide(file).as_ptr()), STGM_READ.0, 0, false, None)?;
        init.Initialize(&stream, STGM_READ.0)?;
        let tp: IThumbnailProvider = init.cast()?;
        let mut hbmp = HBITMAP::default();
        let mut alpha = WTS_ALPHATYPE::default();
        let r = tp.GetThumbnail(size, &mut hbmp, &mut alpha);
        println!("GetThumbnail({size}) -> {:?}", r.as_ref().map_err(|e| e.code()));
        if r.is_ok() {
            let mut bm = BITMAP::default();
            GetObjectW(hbmp.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut c_void));
            println!("  {}x{} bpp={} alpha={:?} topdown_bits={}", bm.bmWidth, bm.bmHeight, bm.bmBitsPixel, alpha, !bm.bmBits.is_null());
            let (w, h) = (bm.bmWidth as u32, bm.bmHeight as u32);
            let src = std::slice::from_raw_parts(bm.bmBits as *const u8, (bm.bmWidthBytes as u32 * h) as usize);
            // premultiplied BGRA -> straight RGBA
            let rgba: Vec<u8> = src
                .chunks_exact(4)
                .flat_map(|p| {
                    let a = p[3] as u32;
                    let un = |c: u8| if a == 0 { 0 } else { ((c as u32 * 255 + a / 2) / a).min(255) as u8 };
                    [un(p[2]), un(p[1]), un(p[0]), p[3]]
                })
                .collect();
            let mut enc = png::Encoder::new(std::io::BufWriter::new(std::fs::File::create(out).unwrap()), w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            enc.write_header().unwrap().write_image_data(&rgba).unwrap();
            println!("  wrote {out}");
            let _ = DeleteObject(hbmp.into());
        }
        drop((tp, init, stream, cf));
        println!("DllCanUnloadNow -> {:?}", can_unload());
    }
    Ok(())
}
