/**
 * 粘贴图片。DESIGN.md §4.3 的 `pasteHandler`
 *
 * `Ctrl/⌘+V` 剪贴板里是图片时：落盘到 `attachments/`，在光标处插入
 * `![[attachments/xxx.png]]`。截图工具、浏览器里的「复制图片」、文件管理器里
 * 复制的图片文件，走的都是这一条。
 */
import { EditorView } from "@codemirror/view";

/** 把图片存进 vault，返回 vault 相对路径。由应用层接到 Rust 侧 */
export type SaveImage = (name: string, dataBase64: string) => Promise<string>;

/** `image/png` → `png`。剪贴板里的图片常常没有文件名，只能从 MIME 反推 */
function extOf(type: string): string {
  const sub = type.split("/")[1]?.split("+")[0]?.toLowerCase() ?? "png";
  return sub === "jpeg" ? "jpg" : sub;
}

/** 没有名字时按时间起一个 —— `image.png` 满 vault 都是，看不出哪张是哪张 */
function nameFor(file: File): string {
  if (file.name && file.name.includes(".")) return file.name;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `粘贴-${stamp}.${extOf(file.type)}`;
}

export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // readAsDataURL 而不是 ArrayBuffer + 手写 base64：后者对几 MB 的图片
    // 要在主线程上跑一遍循环，粘贴的那一下会卡住
    reader.onload = () => {
      const url = String(reader.result);
      const comma = url.indexOf(",");
      resolve(comma < 0 ? "" : url.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取剪贴板图片失败"));
    reader.readAsDataURL(file);
  });
}

export function imagePaste(save: () => SaveImage | undefined, onError: (msg: string) => void) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = [...(event.clipboardData?.items ?? [])];
      const file = items
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .find((f): f is File => !!f);
      if (!file) return false;

      const saveImage = save();
      if (!saveImage) return false;

      // 认下这次粘贴。不拦的话浏览器会把图片的文本表示（往往是空）插进来
      event.preventDefault();

      void (async () => {
        try {
          const rel = await saveImage(nameFor(file), await toBase64(file));
          // 插在**当下**的光标处：落盘是异步的，这中间用户可能已经移动了光标，
          // 那就该插在他现在看的地方
          const at = view.state.selection.main;
          view.dispatch({
            changes: { from: at.from, to: at.to, insert: `![[${rel}]]` },
            selection: { anchor: at.from + rel.length + 5 },
            userEvent: "input.paste.image",
            scrollIntoView: true,
          });
          view.focus();
        } catch (e) {
          onError((e as Error).message);
        }
      })();

      return true;
    },
  });
}
