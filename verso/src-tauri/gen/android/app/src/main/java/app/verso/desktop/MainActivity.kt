package app.verso.desktop

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import androidx.activity.enableEdgeToEdge

/**
 * DESIGN.md §1.2(b)：笔记要放在**用户看得见的目录**里。
 *
 * 安卓 11 起，App 想用真实路径读写共享存储只有一条路：「所有文件访问权限」
 * （思源笔记走的也是这条）。授权之后 vault 就是 /storage/emulated/0/Verso，
 * 文件管理器里看得见、Syncthing 之类也能同步，而 Rust 侧的 std::fs、git2、
 * 文件监听全都照常工作。
 *
 * 没授权也能用 —— 那时退回 App 私有目录（见 Rust 的 `default_vault`），
 * 只是笔记在别处看不见。**所以这里不强制、不循环弹**：每次启动最多带一次
 * 系统设置页，用户点返回就算了。一个把人锁在授权页上的笔记软件更糟。
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    askForAllFilesAccess()
  }

  private fun askForAllFilesAccess() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    if (Environment.isExternalStorageManager()) return
    try {
      startActivity(
        Intent(
          Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
          Uri.parse("package:$packageName"),
        )
      )
    } catch (_: Exception) {
      // 有些定制系统没有这个设置页。**不能让它把 App 拦在启动这一步** ——
      // 私有目录那条退路仍然走得通
    }
  }
}
