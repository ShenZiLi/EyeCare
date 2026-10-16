// 发布构建时不要在 Windows 上弹出额外控制台窗口，请勿删除！
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    eyecare_lib::run();
}
