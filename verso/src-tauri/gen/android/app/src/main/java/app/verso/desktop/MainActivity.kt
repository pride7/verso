package app.verso.desktop

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * DESIGN.md §1.2(b)：笔记要放在**用户看得见的目录**里。
 *
 * 安卓 11 起，App 想用真实路径读写共享存储只有一条路：「所有文件访问权限」
 * （思源笔记走的也是这条）。授权之后 vault 就是 /storage/emulated/0/Verso，
 * 文件管理器里看得见、Syncthing 之类也能同步，而 Rust 侧的 std::fs、git2、
 * 文件监听全都照常工作。
 *
 * 没授权也能用 —— 那时退回 App 私有目录（见 Rust 的 `open_default_vault`），
 * 只是笔记在别处看不见。**所以这里不强制、不循环弹**：每次启动最多带一次
 * 系统设置页，用户点返回就算了。一个把人锁在授权页上的笔记软件更糟。
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    fitSystemBars()
    askForAllFilesAccess()
  }

  /**
   * 让开状态栏和底部手势条。
   *
   * **不能靠 CSS 的 `env(safe-area-inset-*)`** —— 安卓 WebView 里那几个值
   * 只反映挖孔/刘海，**不含系统栏**，于是「界面顶部被状态栏压住」这件事
   * 在 CSS 里怎么写都修不好（v0.6.6–v0.6.8 试了两版都没用）。
   *
   * 安卓 15 起（targetSdk ≥ 35）系统强制全面屏绘制，`setDecorFitsSystemWindows(true)`
   * 已经无效，只能自己听 insets 往内容视图上加内边距。
   *
   * 底部取「手势条」和「输入法」的较大者：软键盘弹出来时，编辑区要缩上去，
   * 否则光标会被键盘盖住 —— 那是手机上写字的主路径。
   */
  private fun fitSystemBars() {
    val content = findViewById<View>(android.R.id.content) ?: return
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
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
