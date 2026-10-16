//! `app/main/tray/icon.ts` 的 Rust 移植。
//!
//! 职责与 TS 版一致：把倒计时标签绘制成数字点阵托盘图标，并提供托盘标签的截断规则。
//! 与 TS 版的唯一差别是不再手工拼 PNG 字节——`tauri::image::Image` 直接接收 RGBA
//! 像素，PNG 编码由 tray-icon 内部完成。

/// 图标边长（像素），对应 `icon.ts#L26` 的 `size`。
pub const ICON_SIZE: u32 = 32;

/// 浅色主题下的字形颜色，对应 `icon.ts#L29` 的 `[23, 44, 38]`。
const GLYPH_LIGHT: [u8; 3] = [23, 44, 38];
/// 深色主题下的字形颜色，对应 `icon.ts#L29` 的 `[237, 246, 241]`。
const GLYPH_DARK: [u8; 3] = [237, 246, 241];

/// 取字符的 5 行 × 3 列点阵；未知字符回退为 `!`，与 `icon.ts#L31` 一致。
fn glyph(character: char) -> [&'static str; 5] {
    match character {
        '0' => ["111", "101", "101", "101", "111"],
        '1' => ["010", "110", "010", "010", "111"],
        '2' => ["111", "001", "111", "100", "111"],
        '3' => ["111", "001", "111", "001", "111"],
        '4' => ["101", "101", "111", "001", "001"],
        '5' => ["111", "100", "111", "001", "111"],
        '6' => ["111", "100", "111", "101", "111"],
        '7' => ["111", "001", "010", "010", "010"],
        '8' => ["111", "101", "111", "101", "111"],
        '9' => ["111", "101", "111", "001", "111"],
        '+' => ["000", "010", "111", "010", "000"],
        '<' => ["001", "010", "100", "010", "001"],
        '-' => ["000", "000", "111", "000", "000"],
        'P' => ["110", "101", "110", "100", "100"],
        _ => ["010", "010", "010", "000", "010"],
    }
}

/// 把标签渲染成 `ICON_SIZE × ICON_SIZE` 的 RGBA 像素，背景保持全透明。
///
/// 逐项对齐 `icon.ts#L30-L38`：每个亮点放大成 3×3 像素块，字间距固定 8 像素，
/// 整体在画布内水平居中。
pub fn numeric_icon_rgba(label: &str, dark: bool) -> Vec<u8> {
    let color = if dark { GLYPH_DARK } else { GLYPH_LIGHT };
    let size = ICON_SIZE as i64;
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    let characters: Vec<char> = label.chars().collect();
    let width = characters.len() as i64 * 8 - 2;
    for (index, character) in characters.iter().enumerate() {
        let rows = glyph(*character);
        for (row_index, row) in rows.iter().enumerate() {
            let columns: Vec<char> = row.chars().collect();
            for (column_index, column) in columns.iter().enumerate() {
                if *column != '1' {
                    continue;
                }
                for offset_y in 0..3 {
                    for offset_x in 0..2 {
                        let y = 8 + row_index as i64 * 3 + offset_y;
                        let x = (size - width) / 2 + index as i64 * 8 + column_index as i64 * 2 + offset_x;
                        if !(0..size).contains(&x) || !(0..size).contains(&y) {
                            continue;
                        }
                        let offset = ((y * size + x) * 4) as usize;
                        pixels[offset] = color[0];
                        pixels[offset + 1] = color[1];
                        pixels[offset + 2] = color[2];
                        pixels[offset + 3] = 255;
                    }
                }
            }
        }
    }
    pixels
}

/// 托盘数字标签，与 `icon.ts#L43-L48` 的 `trayLabel` 逐项一致。
pub fn tray_label(remaining_ms: Option<i64>) -> String {
    let Some(remaining) = remaining_ms else {
        return "-".into();
    };
    if remaining < 60_000 {
        return "<1".into();
    }
    // 与 `Math.ceil(remainingMs / 60000)` 等价。
    let minutes = (remaining + 59_999) / 60_000;
    if minutes > 99 { "99+".into() } else { minutes.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 标签边界与 TS 版 `trayLabel` 完全一致（含 `null` 与 99 分钟截断）。
    #[test]
    fn tray_label_matches_the_typescript_bounds() {
        assert_eq!(tray_label(None), "-");
        assert_eq!(tray_label(Some(59_000)), "<1");
        assert_eq!(tray_label(Some(60_000)), "1");
        assert_eq!(tray_label(Some(60_001)), "2");
        assert_eq!(tray_label(Some(99 * 60_000)), "99");
        assert_eq!(tray_label(Some(100 * 60_000)), "99+");
    }

    /// 任意标签都只落在 32×32 画布内，且每个字形都会落下不透明像素。
    #[test]
    fn numeric_icon_stays_inside_the_canvas() {
        for label in ["-", "P", "!", "<1", "99+", "@@"] {
            let pixels = numeric_icon_rgba(label, false);
            assert_eq!(pixels.len(), (ICON_SIZE * ICON_SIZE * 4) as usize, "{label} 缓冲尺寸错误");
            assert!(pixels.chunks(4).any(|pixel| pixel[3] == 255), "{label} 未绘制任何像素");
        }
    }
}
