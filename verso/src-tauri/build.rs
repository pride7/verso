fn main() {
    // Tauri 只监听配置文件，图标内容变化时不会重建 Windows 资源，任务栏会继续显示旧图标。
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
