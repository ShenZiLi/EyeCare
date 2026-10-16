//! macOS 原生采样。
//!
//! `app/main/platform/native.ts` 中 `createMacProvider` / `createMacLockReader` 的 Rust 移植。
//! 直接绑定系统 C API（CoreGraphics / CoreFoundation / IOKit / libSystem），
//! 与 koffi 版保持同一组符号、同一判定顺序、同一份文案，不引入 ObjC 运行时胶水。

use std::ffi::c_void;
use std::os::raw::{c_char, c_int, c_uint};

use crate::contracts::LockState;

use super::{NativeProvider, finite_idle};

/// `kCFStringEncodingUTF8`，与 native.ts 的 `0x08000100` 一致。
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
/// `kCFNumberSInt64Type`，与 native.ts 的 `number(user, 4, uid)` 一致。
const CF_NUMBER_SINT64_TYPE: isize = 4;
/// 合并会话事件源，对应 `kCGEventSourceStateCombinedSessionState`。
const CG_EVENT_SOURCE_COMBINED: i32 = 0;
/// 「任意事件」哨兵，对应 native.ts 的 `0xffffffff`。
const CG_ANY_EVENT: u32 = 0xffff_ffff;
/// 鼠标来源事件掩码，与 native.ts 的 `[1, 2, 3, 4, 5, 6, 7, 22, 25, 26, 27]` 逐项一致。
const MOUSE_EVENT_TYPES: [u32; 11] = [1, 2, 3, 4, 5, 6, 7, 22, 25, 26, 27];

/// CoreFoundation 对象引用，生命周期由调用方按 Create/Copy 规则管理。
type CfRef = *const c_void;

#[repr(C)]
struct MachTimebaseInfo {
    numer: u32,
    denom: u32,
}

unsafe extern "C" {
    fn mach_timebase_info(info: *mut MachTimebaseInfo) -> c_int;
    fn mach_continuous_time() -> u64;
    fn getuid() -> c_uint;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    fn CGSessionCopyCurrentDictionary() -> CfRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFStringCreateWithCString(allocator: CfRef, bytes: *const c_char, encoding: u32) -> CfRef;
    fn CFDictionaryGetValue(dict: CfRef, key: CfRef) -> CfRef;
    fn CFGetTypeID(value: CfRef) -> usize;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: CfRef) -> u8;
    fn CFDictionaryGetTypeID() -> usize;
    fn CFNumberGetTypeID() -> usize;
    fn CFNumberGetValue(number: CfRef, kind: isize, out: *mut c_void) -> u8;
    fn CFRelease(value: CfRef);
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IORegistryGetRootEntry(master: c_uint) -> c_uint;
    fn IORegistryEntryCreateCFProperty(
        entry: c_uint,
        key: CfRef,
        allocator: CfRef,
        options: c_uint,
    ) -> CfRef;
    fn IOObjectRelease(object: c_uint) -> c_int;
}

/// `CFStringCreateWithCString` 创建、离开作用域即 `CFRelease` 的字典键。
struct SessionKey(CfRef);

impl SessionKey {
    /// 以 UTF-8 创建 CoreFoundation 字符串键。
    fn new(name: &str) -> Result<Self, String> {
        let mut bytes = Vec::with_capacity(name.len() + 1);
        bytes.extend_from_slice(name.as_bytes());
        bytes.push(0);
        let value = unsafe {
            CFStringCreateWithCString(std::ptr::null(), bytes.as_ptr().cast(), CF_STRING_ENCODING_UTF8)
        };
        if value.is_null() { Err("创建会话状态键失败".into()) } else { Ok(Self(value)) }
    }
}

impl Drop for SessionKey {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

/// IOKit 根节点上的 `IOConsoleLocked` 标志。
///
/// 该键在系统缺少显式标志时同样缺失，因此返回值可能是 `Unknown`，
/// 绝不能把「读不到」当作「未锁屏」。
fn registry_lock_state() -> LockState {
    let key = match SessionKey::new("IOConsoleLocked") {
        Ok(key) => key,
        Err(_) => return LockState::Unknown,
    };
    unsafe {
        let entry = IORegistryGetRootEntry(0);
        if entry == 0 {
            return LockState::Unknown;
        }
        let value = IORegistryEntryCreateCFProperty(entry, key.0, std::ptr::null(), 0);
        let state = if value.is_null() {
            LockState::Unknown
        } else {
            let state = if CFGetTypeID(value) == CFBooleanGetTypeID() {
                if CFBooleanGetValue(value) != 0 { LockState::Locked } else { LockState::Unlocked }
            } else {
                LockState::Unknown
            };
            CFRelease(value);
            state
        };
        IOObjectRelease(entry);
        state
    }
}

/// macOS 采样提供者。
pub struct MacProvider {
    /// `mach_continuous_time` 换算为毫秒所需的分子。
    numer: u32,
    /// 换算所需的分钟母；与 `numer` 同时非零才可用。
    denom: u32,
}

impl MacProvider {
    /// 读取时间基准并创建提供者；时间基准不可用时返回错误，由适配层降级为连续时钟故障。
    pub fn create() -> Result<Self, String> {
        let mut base = MachTimebaseInfo { numer: 0, denom: 0 };
        let result = unsafe { mach_timebase_info(&mut base) };
        if result != 0 || base.numer == 0 || base.denom == 0 {
            return Err("连续时钟不可用".into());
        }
        Ok(Self { numer: base.numer, denom: base.denom })
    }

    /// 当前会话锁屏状态。
    ///
    /// 语义与 `createMacLockReader` 完全一致：任何一步拿不到「本会话 + 已在控制台 + 明确布尔」
    /// 的证据都返回 `Unknown`，键缺失只回退到 IOKit 根标志，绝不解释为 `false`。
    fn session_lock_state(&self) -> LockState {
        let (user_key, console_key, lock_key) = match (
            SessionKey::new("kCGSSessionUserIDKey"),
            SessionKey::new("kCGSSessionOnConsoleKey"),
            SessionKey::new("CGSSessionScreenIsLocked"),
        ) {
            (Ok(user), Ok(console), Ok(lock)) => (user, console, lock),
            _ => return LockState::Unknown,
        };
        let dict = unsafe { CGSessionCopyCurrentDictionary() };
        if dict.is_null() {
            return LockState::Unknown;
        }
        let state = unsafe {
            if CFGetTypeID(dict) != CFDictionaryGetTypeID() {
                LockState::Unknown
            } else {
                Self::read_session(dict, &user_key, &console_key, &lock_key)
            }
        };
        unsafe { CFRelease(dict) };
        state
    }

    /// 解析会话字典；调用方保证 `dict` 是 CFDictionary。
    unsafe fn read_session(
        dict: CfRef,
        user_key: &SessionKey,
        console_key: &SessionKey,
        lock_key: &SessionKey,
    ) -> LockState {
        unsafe {
            // 会话必须属于当前进程用户，否则无法代表本会话。
            let user = CFDictionaryGetValue(dict, user_key.0);
            if user.is_null() || CFGetTypeID(user) != CFNumberGetTypeID() {
                return LockState::Unknown;
            }
            let mut uid: i64 = 0;
            let read = CFNumberGetValue(user, CF_NUMBER_SINT64_TYPE, std::ptr::from_mut(&mut uid).cast());
            if read == 0 || uid as u32 != getuid() {
                return LockState::Unknown;
            }
            // 会话不在控制台即视为锁屏；取不到明确布尔值时同样保持未知。
            let on_console = CFDictionaryGetValue(dict, console_key.0);
            if on_console.is_null() || CFGetTypeID(on_console) != CFBooleanGetTypeID() {
                return LockState::Unknown;
            }
            if CFBooleanGetValue(on_console) == 0 {
                return LockState::Locked;
            }
            let value = CFDictionaryGetValue(dict, lock_key.0);
            // 现代 macOS 在未锁屏时省略该键，因此只认 IOKit 根节点的显式标志。
            if value.is_null() {
                return registry_lock_state();
            }
            if CFGetTypeID(value) != CFBooleanGetTypeID() {
                return LockState::Unknown;
            }
            if CFBooleanGetValue(value) != 0 {
                return LockState::Locked;
            }
            // 状态切换期间，会话级的 false 不允许覆盖明确的锁屏标志；
            // 根标志缺失时只有这份「本会话 + 类型正确 + false」的证据才算未锁屏。
            if registry_lock_state() == LockState::Locked { LockState::Locked } else { LockState::Unlocked }
        }
    }

    /// `CGEventSourceSecondsSinceLastEventType` 的秒数采样，换算为毫秒并校验有效性。
    fn seconds_since(event_type: u32) -> Result<f64, String> {
        finite_idle(unsafe { CGEventSourceSecondsSinceLastEventType(CG_EVENT_SOURCE_COMBINED, event_type) } * 1000.0)
    }
}

impl NativeProvider for MacProvider {
    fn now_ms(&self) -> Result<f64, String> {
        let ticks = unsafe { mach_continuous_time() } as f64;
        let now = ticks * self.numer as f64 / self.denom as f64 / 1e6;
        if now.is_finite() { Ok(now) } else { Err("连续时钟不可用".into()) }
    }

    fn combined_idle_ms(&self) -> Result<f64, String> {
        Self::seconds_since(CG_ANY_EVENT)
    }

    fn mouse_idle_ms(&self) -> Result<Option<f64>, String> {
        let mut minimum = f64::INFINITY;
        for event_type in MOUSE_EVENT_TYPES {
            minimum = minimum.min(Self::seconds_since(event_type)?);
        }
        Ok(Some(minimum))
    }

    fn mouse_reason(&self) -> &'static str {
        "CoreGraphics 合并会话事件时间：鼠标移动、鼠标按键、拖动和滚轮；不读取输入内容，需原生设备验收"
    }

    fn lock_state(&self) -> LockState {
        self.session_lock_state()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 时间基准必须在真实 macOS 上可读，且换算结果落在合理区间。
    #[test]
    fn clock_is_monotonic_and_finite() {
        let provider = MacProvider::create().expect("时间基准不可读");
        let first = provider.now_ms().expect("连续时钟不可用");
        std::thread::sleep(std::time::Duration::from_millis(20));
        let second = provider.now_ms().expect("连续时钟不可用");
        assert!(first.is_finite() && first >= 0.0, "首个时间为 {first}");
        assert!(second >= first, "连续时钟倒退：{first} → {second}");
        assert!(second - first >= 10.0, "20ms 睡眠仅推进了 {}ms", second - first);
    }

    /// 空闲时间必须非负且有限；系统空闲上限不应超过一年。
    #[test]
    fn idle_is_finite_and_non_negative() {
        let provider = MacProvider::create().expect("时间基准不可读");
        let combined = provider.combined_idle_ms().expect("合并输入空闲读取失败");
        assert!(combined.is_finite() && combined >= 0.0, "合并空闲为 {combined}");
        assert!(combined < 365.0 * 24.0 * 3600.0 * 1000.0, "合并空闲异常偏大：{combined}");
    }

    /// 鼠标来源必须给出有限值，且不早于同源的合并空闲时间。
    #[test]
    fn mouse_idle_matches_combined_window() {
        let provider = MacProvider::create().expect("时间基准不可读");
        let combined = provider.combined_idle_ms().expect("合并输入空闲读取失败");
        let mouse = provider.mouse_idle_ms().expect("鼠标空闲读取失败").expect("鼠标来源应返回数值");
        assert!(mouse.is_finite() && mouse >= 0.0, "鼠标空闲为 {mouse}");
        // 鼠标事件是合并输入的子集：键盘事件更近时鼠标空闲必然更大，只有浮点与采样
        // 抖动会让它略小于合并空闲（对齐 `native.ts` 的 `Math.min(鼠标事件)` 语义）。
        assert!(mouse + 1000.0 >= combined, "鼠标空闲 {mouse} 早于合并空闲 {combined}");
    }
}
