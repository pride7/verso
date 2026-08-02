# 打一个 arm64 的 debug APK。
#
# 为什么需要这个脚本，而不是直接 `pnpm tauri android build`：
# 那条命令最后一步要把 `.so` **软链**到 gen/android 的 jniLibs 里，而 Windows
# 上非管理员建符号链接要先开「开发者模式」。开发机没开，于是它每次都在
# 「Rust 已经编完了」之后倒在最后一格。
#
# 这里把那一步换成拷贝，再用 `-x rustBuildArm64Debug` 让 gradle 跳过它自己
# 那次 cargo（不跳的话它会重跑一遍，然后撞上同一个链接）。
#
# 开发者模式一旦打开，这个脚本就可以扔掉，直接用 `pnpm tauri android build`。
# 详见 AGENTS.md「Android 构建：踩过的四个坑」。

$ErrorActionPreference = 'Stop'

$env:ANDROID_HOME = 'D:\Scoop\apps\android-clt\current'
$env:NDK_HOME = 'D:\Scoop\apps\android-clt\current\ndk\27.2.12479018'
$env:JAVA_HOME = 'D:\Scoop\apps\openjdk17\current'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

$root = Split-Path $PSScriptRoot -Parent
$so = Join-Path $root 'src-tauri\target\aarch64-linux-android\debug\libverso_lib.so'
$jni = Join-Path $root 'src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a'

Push-Location $root
try {
    # 这一步一定会以「符号链接失败」结束 —— 我们要的是它前面那段：
    # 用配好的 NDK 环境把 .so 编出来
    Write-Host '== 编 Rust（最后的符号链接会失败，是预期的）==' -ForegroundColor Cyan
    pnpm tauri android build --debug --target aarch64 2>&1 | Select-Object -Last 3

    if (-not (Test-Path $so)) { throw ".so 没编出来：$so" }

    # `tauri android init` **不认 src-tauri/icons/android/**，会自己塞一套
    # Tauri 默认 logo 进去。每次打包都覆盖回真图标，免得哪天重新 init 之后
    # 又变回那个青黄配色的默认图案
    $icons = Join-Path $root 'src-tauri\icons\android'
    $res = Join-Path $root 'src-tauri\gen\android\app\src\main\res'
    if (Test-Path $icons) {
        Copy-Item "$icons\mipmap-*" $res -Recurse -Force
        Copy-Item "$icons\values\*" (Join-Path $res 'values') -Force
    }

    Write-Host '== 拷 .so 到 jniLibs ==' -ForegroundColor Cyan
    New-Item -ItemType Directory -Force $jni | Out-Null
    Copy-Item $so (Join-Path $jni 'libverso_lib.so') -Force

    # gradle 的 native libs 合并产物有时会和我们手拷进去的那份重复，打出来的
    # APK 里就有**两个同名的 .so** —— 文件大一倍，而 `unzip -l` 只显示最后
    # 一个，所以「列出来的总和」和文件大小对不上（189 MB 的内容，335 MB 的包）。
    # 每次打包前清掉它
    $inter = Join-Path $root 'src-tauri\gen\android\app\build\intermediates'
    foreach ($d in 'merged_native_libs', 'stripped_native_libs') {
        $p = Join-Path $inter $d
        if (Test-Path $p) { Remove-Item -Recurse -Force $p }
    }

    Write-Host '== 打包 APK ==' -ForegroundColor Cyan
    Set-Location (Join-Path $root 'src-tauri\gen\android')
    .\gradlew.bat assembleArm64Debug -x rustBuildArm64Debug --console=plain 2>&1 |
        Select-String -Pattern 'BUILD|FAILURE|What went wrong' | Select-Object -Last 5

    $apk = Join-Path $root 'src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk'
    if (Test-Path $apk) {
        $mb = [math]::Round((Get-Item $apk).Length / 1MB, 1)
        Write-Host "APK: $apk ($mb MB)" -ForegroundColor Green
        Write-Host '装到手机：adb install -r "' -NoNewline; Write-Host "$apk`"" -NoNewline; Write-Host ''
    } else {
        throw "APK 没生成"
    }
} finally {
    Pop-Location
}
