/**
 * 粘贴图片与拖入附件。DESIGN.md §4.3 / §4.4 的 `pasteHandler`
 *
 * `Ctrl/⌘+V` 剪贴板里是图片时：落盘到 `attachments/`，在光标处插入
 * `![[attachments/xxx.png]]`。截图工具、浏览器里的「复制图片」、文件管理器里
 * 复制的图片文件，走的都是这一条。
 */
import { EditorView } from "@codemirror/view";

/** 把文件存进 vault，返回 vault 相对路径。由应用层接到 Rust 侧 */
export type SaveAttachment = (name: string, dataBase64: string) => Promise<string>;

/** `image/png` → `png`。剪贴板里的图片常常没有文件名，只能从 MIME 反推 */
function extOf(type: string): string {
  const sub = type.split("/")[1]?.split("+")[0]?.toLowerCase() ?? "png";
  return sub === "jpeg" ? "jpg" : sub;
}

/** 没有名字时按时间起一个 —— `image.png` 满 vault 都是，看不出哪张是哪张 */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function nameFor(file: File, prefix = "粘贴"): string {
  if (file.name && file.name.includes(".")) return file.name;
  if (file.name) return file.name;
  const ext = file.type ? `.${extOf(file.type)}` : "";
  return `${prefix}-${stamp()}${ext}`;
}

function image(file: File): boolean {
  return file.type.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(file.name);
}

function markup(file: File, rel: string): string {
  return `${image(file) ? "!" : ""}[[${rel}]]`;
}

/**
 * 这是不是一次从系统文件管理器进来的拖放。
 *
 * WebKit 在 dragover 阶段常常把 `files` 藏起来，只留下 `Files` 类型；两个都
 * 要认。这个判断也给 App 的全窗口导航护栏复用。
 */
export function hasTransferredFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  // 应用内的文档树拖拽在浏览器测试和部分 WebView 中可能只提供 `types` / 文本
  // 数据，不保证有完整的 FileList。它不是系统文件拖入，也不能让全局护栏报错。
  const files = transfer.files;
  const types = transfer.types;
  return (files?.length ?? 0) > 0 || (!!types && Array.from(types).includes("Files"));
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

async function insertDroppedFiles(
  view: EditorView,
  files: File[],
  saveAttachment: SaveAttachment,
  onError: (msg: string) => void,
) {
  const inserted: string[] = [];
  for (const file of files) {
    try {
      const rel = await saveAttachment(nameFor(file, "附件"), await toBase64(file));
      inserted.push(markup(file, rel));
    } catch (e) {
      onError(`${file.name || "文件"}：${(e as Error).message}`);
    }
  }
  if (!inserted.length) return;

  // 保存是异步的，按用户此刻的光标插入；拖入图片不应把 WebView 导航到图片。
  const selection = view.state.selection.main;
  const value = inserted.join("\n");
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: value },
    selection: { anchor: selection.from + value.length },
    userEvent: "input.drop.attachment",
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * 在 CodeMirror 的**整个宿主**上接住系统文件拖放。
 *
 * `EditorView.domEventHandlers` 只监听 `.cm-content`。正文很短时，下面大片空白
 * 属于 `.editor-host`；文件落在那里不会经过 `.cm-content`，WebView 的默认动作
 * 就是直接打开图片/PDF。用宿主的 capture listener 才能覆盖真实的拖放区域。
 */
export function installAttachmentDrop(
  root: HTMLElement,
  view: EditorView,
  save: () => SaveAttachment | undefined,
  onError: (msg: string) => void,
): () => void {
  const dragover = (event: DragEvent) => {
    if (!hasTransferredFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  const drop = (event: DragEvent) => {
    if (!hasTransferredFiles(event.dataTransfer)) return;

    // 必须先拦默认动作。即使这一刻存盘能力不可用，也绝不能把整个应用导航到
    // 图片或 PDF；那种页面没有 Verso 的返回入口。
    event.preventDefault();
    event.stopPropagation();

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    const saveAttachment = save();
    if (!saveAttachment) {
      onError("请先打开仓库，再拖入附件");
      return;
    }
    void insertDroppedFiles(view, files, saveAttachment, onError);
  };

  root.addEventListener("dragover", dragover, true);
  root.addEventListener("drop", drop, true);
  return () => {
    root.removeEventListener("dragover", dragover, true);
    root.removeEventListener("drop", drop, true);
  };
}

export function imagePaste(
  save: () => SaveAttachment | undefined,
  onError: (msg: string) => void,
) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = [...(event.clipboardData?.items ?? [])];
      const file = items
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .find((f): f is File => !!f);
      if (!file) return false;

      const saveAttachment = save();
      if (!saveAttachment) return false;

      // 认下这次粘贴。不拦的话浏览器会把图片的文本表示（往往是空）插进来
      event.preventDefault();

      void (async () => {
        try {
          const rel = await saveAttachment(nameFor(file), await toBase64(file));
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
