import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Icon } from "./Icon";
import { confirm } from "../lib/dialog";
import {
  ancestorLines,
  clampNodeW,
  displayRoot,
  editAddChild,
  editAddSibling,
  editMove,
  editRemove,
  editText,
  editToggleTask,
  findNode,
  flatten,
  layout,
  nodeKeyMap,
  NODE_H,
  NODE_W,
  parseMindmap,
  parentOf,
  subtreeSize,
  type Edit,
  type MindNode,
  type MovePosition,
  type Placed,
} from "../lib/mindmap";

interface Props {
  /** 只用于把节点宽度记到这篇笔记名下，不会写进 Markdown。 */
  storageKey: string;
  /** 笔记标题。正文里没有「唯一的一级标题」时，它就是导图的根节点 */
  title: string;
  /** 正文原文。改完由外面写回编辑器，再作为新的 `body` 传下来 */
  body: string;
  onEdit: (edit: Edit) => void;
  onUndo?: () => boolean | void;
  onRedo?: () => boolean | void;
  /** 跳到正文的某一行（并关掉导图） */
  onGoto: (line: number) => void;
  onClose: () => void;
  /**
   * 这是台没有右键的设备（移动端）。
   *
   * 只影响一件事：节点上那个 `⋯` 出不出现。桌面上右键就是菜单，节点上再摆按钮
   * 纯属噪音 —— 一张图几十个节点，每个都挂着一排图标，眼睛先看见的是按钮不是
   * 内容。**CSS 里还有一条 `hover: none` 兜底**：触屏笔记本平台上不算移动端，
   * 但那儿同样没有悬停
   */
  touch?: boolean;
}

/** 相机：`x`/`y` 是画布内的平移量（像素），`k` 是缩放 */
interface Cam {
  x: number;
  y: number;
  k: number;
}

/** 缩放的上下限。滚轮、捏合、加减号三条路必须用同一个，否则各缩各的 */
const clampZoom = (k: number) => Math.min(2.5, Math.max(0.25, k));

/** 拖出来的节点宽度记在这台机器上（和侧栏宽度、历史面板高度一个待遇） */
const WIDTHS_KEY = "verso.mindmapNodeWidths";

/**
 * 思维导图。DESIGN.md §4.7
 *
 * **一个节点就是正文里的一行**，布局每次算出来，一个字节都不额外存。在图上
 * 改一下 = 改那一行 Markdown，走的是编辑器自己的 dispatch —— 所以撤销、
 * 自动保存、外部改动检测全都免费正确，导图不需要自己那一套。
 *
 * 键盘按 XMind 的习惯：Enter 加兄弟、Tab 加子节点、F2 改字、Delete 删子树。
 * 全部有等价的鼠标操作（§0：不能假设有键盘）—— 而在触摸屏上，鼠标那一套里
 * 「双击改字」「右键出菜单」同样不存在，所以每个节点都有一个 `⋯`：菜单里是
 * 全部动作，不依赖任何键、任何长按合成。
 *
 * 平移和缩放走 pointer 事件（单指拖、双指捏），滚轮只是桌面上的加速通道。
 */
export function MindMap({ storageKey, title, body, onEdit, onUndo, onRedo, onGoto, onClose, touch }: Props) {
  const root = useMemo(() => parseMindmap(body, title), [body, title]);
  /**
   * 画出来的根。正文里只有一个一级标题时它才是根，笔记名让位（见 `displayRoot`）
   * —— 所以下面凡是「图上」的事都用 `shown`，凡是「按行号找节点」的事仍用 `root`
  */
  const shown = useMemo(() => displayRoot(root), [root]);
  /** 折叠按结构身份记，不按会随编辑漂移的行号记。 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const nodeKeys = useMemo(() => nodeKeyMap(root), [root]);
  /**
   * 每个节点量出来有多高（行号 → 像素）。
   *
   * 文字换行之后高度取决于字体、字号和用户调过的排版设置 —— **算不出来，只能
   * 量**。所以是两趟：先按上一次的高度排一版，渲染完在 `useLayoutEffect` 里量
   * 一遍，变了就再排一版（浏览器画之前完成，看不到中间态）。量的是 `offsetHeight`
   * 而不是 `getBoundingClientRect` —— 后者带着画布的缩放，捏一下就全变了
   */
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(new Map());
  /** 每个节点独立的宽度偏好。key 用结构身份，正文上方插删行不会串给另一节点。 */
  const widthStorageKey = `${WIDTHS_KEY}:${storageKey}`;
  const [nodeWidths, setNodeWidths] = useState<ReadonlyMap<string, number>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(widthStorageKey) ?? "{}") as Record<string, unknown>;
      return new Map(
        Object.entries(saved)
          .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
          .map(([key, width]) => [key, clampNodeW(width)]),
      );
    } catch {
      return new Map();
    }
  });
  const nodeWidthOf = useCallback(
    (line: number) => nodeWidths.get(nodeKeys.get(line) ?? "") ?? NODE_W,
    [nodeKeys, nodeWidths],
  );
  const [selected, setSelected] = useState(0);
  const previousNodeKeys = useRef(nodeKeys);
  const [query, setQuery] = useState("");
  /** 只画这一支；null 表示整张图。 */
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ line: number; position: MovePosition } | null>(null);
  /** 触屏没有 HTML 拖放，用菜单进入“选一个新父级”模式。 */
  const [moveSource, setMoveSource] = useState<number | null>(null);

  const focusedRoot = useMemo(
    () => (focusLine === null ? shown : findNode(shown, focusLine) ?? shown),
    [focusLine, shown],
  );
  const focusedNodes = useMemo(() => flatten(focusedRoot), [focusedRoot]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchMatches = useMemo(
    () => new Set(
      normalizedQuery
        ? focusedNodes
          .filter((node) => node.text.toLocaleLowerCase().includes(normalizedQuery))
          .map((node) => node.line)
        : [],
    ),
    [focusedNodes, normalizedQuery],
  );
  const searchContext = useMemo(() => {
    const lines = new Set<number>();
    for (const line of searchMatches) {
      for (const ancestor of ancestorLines(focusedRoot, line)) lines.add(ancestor);
    }
    return lines;
  }, [focusedRoot, searchMatches]);
  const collapsedLines = useMemo(() => {
    const lines = new Set<number>();
    for (const [line, key] of nodeKeys) {
      if (collapsed.has(key) && !(normalizedQuery && searchContext.has(line))) lines.add(line);
    }
    return lines;
  }, [collapsed, nodeKeys, normalizedQuery, searchContext]);
  const view = useMemo(
    () => layout(focusedRoot, collapsedLines, (line) => heights.get(line) ?? NODE_H, nodeWidthOf),
    [focusedRoot, collapsedLines, heights, nodeWidthOf],
  );
  /**
   * 正在改字的是哪个节点。null = 没在改。
   *
   * **草稿不进 state，输入框是非受控的**（和文档树的就地改名同一个做法）：
   * 一是每敲一个字符就重渲染整张图不值得，二是受控输入在这里没有任何好处
   * —— 提交时从 DOM 读一次就够了。
   */
  const [editing, setEditing] = useState<number | null>(null);
  /** 节点菜单：触摸屏上唯一能拿到全部动作的入口，桌面上右键也走它 */
  const [menu, setMenu] = useState<{ line: number; x: number; y: number } | null>(null);
  const [cam, setCam] = useState<Cam>({ x: 40, y: 40, k: 1 });

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** state 来不及阻止同一次 pointerdown 后续的 blur，用 ref 保证提交只发生一次。 */
  const editingRef = useRef<number | null>(null);
  const beginEdit = useCallback((line: number) => {
    editingRef.current = line;
    setEditing(line);
  }, []);
  const cancelEdit = useCallback(() => {
    editingRef.current = null;
    setEditing(null);
    requestAnimationFrame(() => hostRef.current?.focus());
  }, []);
  /**
   * 相机的真身在这个 ref 里，`cam` 只负责渲染。
   *
   * 手势要在按下的那一刻取一份基准（拖多远 = 移多远），而 state 是下一次渲染
   * 才到手的 —— 捏合结束顺势转成单指平移时，这一帧的差别正好就是「图跳一下」。
   */
  const camRef = useRef(cam);
  const applyCam = useCallback((next: Cam | ((c: Cam) => Cam)) => {
    const v = typeof next === "function" ? next(camRef.current) : next;
    camRef.current = v;
    setCam(v);
  }, []);
  /**
   * 刚加出来的那一行。正文回来之后要立刻把它切进编辑态 ——
   * 加完一个空节点还要用户自己去图上找它在哪，这个功能就没法用了
   */
  const pending = useRef<number | null>(null);
  /** 新建后尚未确认的空节点。Esc 应撤掉这次创建，而不是留下孤零零的 `- `。 */
  const createdEditingRef = useRef<number | null>(null);
  /** 移动后目标行号可能变化，用结构身份在新正文里重新选中它。 */
  const pendingSelectionKey = useRef<string | null>(null);

  const placedOf = useCallback(
    (line: number) => view.nodes.find((p) => p.node.line === line) ?? null,
    [view],
  );

  /** 按 y 排好的可见节点，上下移动和「下一个」都用它 */
  const ordered = useMemo(() => [...view.nodes].sort((a, b) => a.y - b.y), [view]);

  /**
   * 菜单开着的是哪个节点。**每次渲染重新查** —— 菜单开着的时候正文可能被外面
   * 改掉（AI 在终端里跑、同步拉下来），行号一变，攥着旧对象就会去改错的一行
   */
  const menuNode = menu ? findNode(root, menu.line) : null;

  // 新节点一出现就进编辑态
  useEffect(() => {
    const line = pending.current;
    if (line === null) return;
    if (!placedOf(line)) return;
    pending.current = null;
    createdEditingRef.current = line;
    setSelected(line);
    beginEdit(line);
  }, [beginEdit, placedOf]);

  useEffect(() => {
    const key = pendingSelectionKey.current;
    if (!key) return;
    const found = [...nodeKeys.entries()].find(([, candidate]) => candidate === key);
    if (!found) return;
    pendingSelectionKey.current = null;
    setSelected(found[0]);
  }, [nodeKeys]);

  useEffect(() => {
    const previous = previousNodeKeys.current;
    previousNodeKeys.current = nodeKeys;
    const oldKey = previous.get(selected);
    if (!oldKey || nodeKeys.get(selected) === oldKey) return;
    const shifted = [...nodeKeys.entries()].find(([, key]) => key === oldKey);
    if (shifted) setSelected(shifted[0]);
  }, [nodeKeys, selected]);

  /**
   * 选中的节点没画在图上时，落回图的根。
   *
   * 两种情形：一是笔记名让位给了一级标题（初始的 `selected = 0` 那个节点这时
   * 根本不在图上），二是选中的那一行被外面改没了。**不看折叠** —— 折叠一支
   * 就把选中扔回根上太粗暴了，那一行仍然在文档里
   */
  useEffect(() => {
    if (focusLine !== null && !findNode(shown, focusLine)) setFocusLine(null);
    if (!findNode(focusedRoot, selected)) setSelected(focusedRoot.line);
    else if (selected === 0 && focusedRoot.line !== 0) setSelected(focusedRoot.line);
  }, [focusLine, focusedRoot, selected, shown]);

  /**
   * 量一遍节点高度，变了就记下来重排。
   *
   * 高度只跟内容有关、跟位置无关，所以这个循环一定收敛：第二趟量到的和记下的
   * 一样就停。**每次渲染都要跑** —— 换一篇笔记、改一行字、字号变了都会改高度
   */
  useLayoutEffect(() => {
    const next = new Map<number, number>();
    let changed = false;
    for (const el of canvasRef.current?.querySelectorAll<HTMLElement>(".mm-node") ?? []) {
      const line = Number(el.dataset.line);
      const h = el.offsetHeight;
      if (!Number.isFinite(line) || h <= 0) continue;
      next.set(line, h);
      if (Math.abs((heights.get(line) ?? NODE_H) - h) > 0.5) changed = true;
    }
    // 少了节点（删掉、折叠）也要更新，否则旧高度会一直挂在表里
    if (changed || next.size !== heights.size) setHeights(next);
  });

  useEffect(() => {
    if (editing !== null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  /** 多行节点改字时让输入框随内容长高，但别把一张大卡片顶出视口。 */
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || editing === null) return;
    input.style.height = "0";
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  }, [editing]);

  /** 打开时把整张图放进视口 */
  const fit = useCallback(() => {
    const box = hostRef.current?.getBoundingClientRect();
    if (!box) return;
    const pad = 48;
    const k = Math.min(
      1,
      (box.width - pad * 2) / Math.max(view.width, 1),
      (box.height - pad * 2 - 40) / Math.max(view.height, 1),
    );
    const fittedK = Math.max(k, 0.3);
    applyCam({
      k: fittedK,
      x: Math.max(pad, (box.width - view.width * fittedK) / 2),
      y: Math.max(pad, (box.height - view.height * fittedK) / 2),
    });
  }, [applyCam, view.width, view.height]);

  /** 以画布中心为锚点缩放。滚轮和捏合都够不着的时候（平板、没有触摸的窄屏）走这个 */
  const zoomBy = useCallback(
    (ratio: number) => {
      const box = canvasRef.current?.getBoundingClientRect();
      const mx = (box?.width ?? 0) / 2;
      const my = (box?.height ?? 0) / 2;
      applyCam((c) => {
        const k = clampZoom(c.k * ratio);
        const r = k / c.k;
        return { k, x: mx - (mx - c.x) * r, y: my - (my - c.y) * r };
      });
    },
    [applyCam],
  );

  const zoomTo = useCallback(
    (next: number) => {
      const box = hostRef.current?.getBoundingClientRect();
      const mx = (box?.width ?? 0) / 2;
      const my = (box?.height ?? 0) / 2;
      applyCam((c) => {
        const k = clampZoom(next);
        const r = k / c.k;
        return { k, x: mx - (mx - c.x) * r, y: my - (my - c.y) * r };
      });
    },
    [applyCam],
  );

  useEffect(() => {
    fit();
    hostRef.current?.focus();
    // 只在打开时铺一次：之后每加一个节点都重新 fit 的话，图会在脚下乱跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切到“只看这一支”或回到全图时，那一支应该立刻完整出现。
  useEffect(() => {
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
    // 只响应模式切换；节点增删不能把用户手动调好的视角抢走。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLine]);

  /** 键盘和搜索选到屏幕外的节点时，只移动“刚好够”的距离把它带回来。 */
  useLayoutEffect(() => {
    const box = hostRef.current?.getBoundingClientRect();
    const placed = placedOf(selected);
    if (!box || !placed) return;
    const c = camRef.current;
    const margin = 32;
    const top = 48 + margin;
    const left = c.x + placed.x * c.k;
    const right = left + placed.w * c.k;
    const y = c.y + placed.y * c.k;
    const bottom = y + placed.h * c.k;
    let dx = 0;
    let dy = 0;
    if (left < margin) dx = margin - left;
    else if (right > box.width - margin) dx = box.width - margin - right;
    if (y < top) dy = top - y;
    else if (bottom > box.height - margin) dy = box.height - margin - bottom;
    if (dx || dy) applyCam((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }, [applyCam, placedOf, selected]);

  // 滚轮缩放。**必须用非被动监听**，否则 preventDefault 无效，
  // 缩放的同时整个面板还会跟着滚
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const mx = e.clientX - box.left;
      const my = e.clientY - box.top;
      applyCam((c) => {
        const k = clampZoom(c.k * Math.exp(-e.deltaY * 0.0015));
        const r = k / c.k;
        // 以鼠标为锚点缩放：光标底下那个点保持不动
        return { k, x: mx - (mx - c.x) * r, y: my - (my - c.y) * r };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyCam]);

  /**
   * 平移与缩放：单指拖背景、双指捏合。
   *
   * 用 pointer 而不是 mouse —— 安卓 WebView 合成鼠标事件既晚又只有一根手指，
   * 捏合在那套事件里根本表达不出来（`.mm-canvas` 还配了 `touch-action: none`，
   * 否则手势会先被 WebView 拿去滚页面）。
   *
   * 手指按在节点上时**不平移但照样计数** —— 捏合时有一根落在节点上是常事，
   * 漏掉它就会变成「两根手指在缩放，图却在跟着平移」。
   */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const pts = new Map<number, { x: number; y: number }>();
    let pan: { id: number; x: number; y: number; cx: number; cy: number; active: boolean } | null = null;
    let pinch: { d: number; mx: number; my: number; k: number; cx: number; cy: number } | null = null;

    /** 两指之间的距离与中点（中点换算成画布内坐标，和滚轮那套锚点一致） */
    const span = () => {
      const [a, b] = [...pts.values()];
      const box = el.getBoundingClientRect();
      return {
        d: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
        mx: (a.x + b.x) / 2 - box.left,
        my: (a.y + b.y) / 2 - box.top,
      };
    };

    const startPan = (id: number, x: number, y: number) => {
      const c = camRef.current;
      pan = { id, x, y, cx: c.x, cy: c.y, active: false };
    };
    const startPinch = () => {
      pan = null;
      el.classList.add("is-panning");
      const s = span();
      const c = camRef.current;
      pinch = { d: s.d, mx: s.mx, my: s.my, k: c.k, cx: c.x, cy: c.y };
    };

    const onDown = (e: PointerEvent) => {
      // 鼠标只认左键：右键要留给节点菜单
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2) {
        startPinch();
        return;
      }
      if ((e.target as HTMLElement).closest(".mm-node")) return;
      // 拦住默认行为是为了不选中文字；只在真的要平移时拦，
      // 否则会顺手掐掉节点上的双击和按钮
      e.preventDefault();
      // 抓住这个指针，松手松在窗口外面也照样收得到 pointerup。收不到的话
      // 它会一直留在 pts 里，下一次单指按下就被当成第二根手指 —— 图会直接跳走。
      // **只抓平移那一根**：抓在节点上会把 click 的目标一起改掉
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // 指针已经没了（真机上偶发），当作没按下过
      }
      startPan(e.pointerId, e.clientX, e.clientY);
    };

    const onMove = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;

      if (pinch && pts.size >= 2) {
        const s = span();
        const k = clampZoom(pinch.k * (s.d / pinch.d));
        const r = k / pinch.k;
        // 捏合开始时中点底下的那个点，跟着中点走 —— 于是双指同时也能平移
        applyCam({ k, x: s.mx - (pinch.mx - pinch.cx) * r, y: s.my - (pinch.my - pinch.cy) * r });
        return;
      }
      if (pan && e.pointerId === pan.id) {
        const { cx, cy, x, y } = pan;
        if (!pan.active) {
          // 鼠标按下后不可避免会抖一两像素。没越过阈值就是一次点击，不应让画布
          // 偷偷挪动，也不该让“点背景确认编辑”看起来像拖拽。
          if (Math.hypot(e.clientX - x, e.clientY - y) < 5) return;
          pan.active = true;
          el.classList.add("is-panning");
        }
        applyCam((c) => ({ ...c, x: cx + (e.clientX - x), y: cy + (e.clientY - y) }));
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      pinch = null;
      if (pan?.id === e.pointerId) pan = null;
      el.classList.remove("is-panning");
      // 松开一根还剩两根：接着捏。剩一根：顺势转成平移，不要等用户重新按一下
      if (pts.size >= 2) startPinch();
      else if (pts.size === 1) {
        const [[id, p]] = [...pts.entries()];
        startPan(id, p.x, p.y);
      }
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.classList.remove("is-panning");
    };
  }, [applyCam]);

  /**
   * 拖右边缘只改当前节点。宽度是这台设备上的视图偏好，不写进 Markdown；布局会
   * 用每一列最宽的节点给下一列让位，所以独立宽度不会换来节点互相遮挡。
   */
  const persistWidths = (widths: ReadonlyMap<string, number>) => {
    if (widths.size === 0) localStorage.removeItem(widthStorageKey);
    else localStorage.setItem(widthStorageKey, JSON.stringify(Object.fromEntries(widths)));
  };

  const startResize = (e: React.PointerEvent, line: number) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const key = nodeKeys.get(line);
    if (!key) return;
    e.preventDefault();
    // 不能冒泡到画布：拖宽度的时候图不该跟着平移
    e.stopPropagation();
    const startX = e.clientX;
    const base = nodeWidthOf(line);
    let last = base;
    let lastWidths = new Map(nodeWidths);
    const move = (m: PointerEvent) => {
      // 画布是缩放过的：屏幕上拖 10px，图里不是 10px
      last = clampNodeW(base + (m.clientX - startX) / camRef.current.k);
      lastWidths = new Map(lastWidths);
      lastWidths.set(key, last);
      setNodeWidths(lastWidths);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      lastWidths.set(key, last);
      persistWidths(lastWidths);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const resetWidth = (line: number) => {
    const key = nodeKeys.get(line);
    if (!key) return;
    const next = new Map(nodeWidths);
    next.delete(key);
    setNodeWidths(next);
    persistWidths(next);
  };

  const toggleFold = (line: number) =>
    setCollapsed((s) => {
      const key = nodeKeys.get(line);
      if (!key) return s;
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // ---- 节点菜单 ----

  /** 点别处、改窗口大小就关掉。用 pointerdown：触摸屏上的 mousedown 是合成的，来得晚 */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // 贴着屏幕边打开时往回收。手机屏幕小，靠右下角的节点必然撞边
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const box = el.getBoundingClientRect();
    el.style.left = `${Math.max(6, Math.min(menu.x, window.innerWidth - box.width - 6))}px`;
    el.style.top = `${Math.max(6, Math.min(menu.y, window.innerHeight - box.height - 6))}px`;
  }, [menu]);

  const openMenu = (line: number, x: number, y: number) => {
    setSelected(line);
    setMenu({ line, x, y });
  };

  /** 菜单项：点完先关菜单，再做事 */
  const act = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  // ---- 改文本的四个动作 ----

  const commitEdit = () => {
    const line = editingRef.current;
    if (line === null) return;
    // pointerdown capture 和随后发生的 blur 会先后走到这里。同步清 ref，确保同一份
    // 草稿只 dispatch 一次；等 React state 更新来拦已经晚了。
    editingRef.current = null;
    createdEditingRef.current = null;
    const node = findNode(root, line);
    const text = (inputRef.current?.value ?? "").trim();
    setEditing(null);
    if (!node || node.kind === "root") return; // 根是笔记标题，改名走文档树
    // 清空一个节点等于删掉它 —— 留一行光秃秃的 `- ` 在文件里没有意义
    onEdit(text ? editText(node, text) : editRemove(node));
  };

  const cancelCurrentEdit = () => {
    const createdLine = createdEditingRef.current;
    createdEditingRef.current = null;
    cancelEdit();
    if (createdLine === null) return;
    const created = findNode(root, createdLine);
    if (created && created.kind !== "root") onEdit(editRemove(created));
  };

  const addChild = (node: MindNode) => {
    const { edit, line } = editAddChild(node);
    pending.current = line;
    setCollapsed((s) => {
      const next = new Set(s);
      const key = nodeKeys.get(node.line);
      if (key) next.delete(key); // 加到折叠的分支上，得先把它展开
      return next;
    });
    onEdit(edit);
  };

  const addSibling = (node: MindNode) => {
    if (node.kind === "root") return addChild(node);
    const { edit, line } = editAddSibling(node);
    pending.current = line;
    onEdit(edit);
  };

  const remove = async (node: MindNode) => {
    if (node.kind === "root") return;
    const n = subtreeSize(node);
    // 只有一个节点时不问 —— 那种误删按一次撤销就回来了；连着子树一起没了
    // 才是「刚才那一整块哪去了」的那种慌
    if (n > 1 && !(await confirm(`删掉「${node.text}」和它底下的 ${n - 1} 个节点？`))) return;
    const parent = parentOf(root, node.line);
    setSelected(parent?.line ?? 0);
    onEdit(editRemove(node));
  };

  const moveNode = (sourceLine: number, targetLine: number, position: MovePosition) => {
    const edit = editMove(body, root, sourceLine, targetLine, position);
    if (!edit) return false;
    pendingSelectionKey.current = nodeKeys.get(targetLine) ?? null;
    setSelected(targetLine);
    setDragged(null);
    setDrop(null);
    setMoveSource(null);
    onEdit(edit);
    requestAnimationFrame(() => hostRef.current?.focus());
    return true;
  };

  const siblingMove = (node: MindNode, direction: -1 | 1) => {
    const parent = parentOf(root, node.line);
    if (!parent) return;
    const at = parent.children.findIndex((child) => child.line === node.line);
    const target = parent.children[at + direction];
    if (!target) return;
    moveNode(node.line, target.line, direction < 0 ? "before" : "after");
  };

  const matchOrder = useMemo(
    () => focusedNodes.filter((node) => searchMatches.has(node.line)),
    [focusedNodes, searchMatches],
  );
  const activePath = useMemo(() => new Set(ancestorLines(focusedRoot, selected)), [focusedRoot, selected]);

  const cycleSearch = (backward: boolean) => {
    if (matchOrder.length === 0) return;
    const at = matchOrder.findIndex((node) => node.line === selected);
    const next = backward
      ? matchOrder[(at <= 0 ? matchOrder.length : at) - 1]
      : matchOrder[(at + 1) % matchOrder.length];
    setSelected(next.line);
  };

  // ---- 键盘 ----

  const onKey = (e: React.KeyboardEvent) => {
    if (editing !== null) return; // 编辑态里的键归输入框
    if ((e.ctrlKey || e.metaKey) && e.key.toLocaleLowerCase() === "f") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLocaleLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) onRedo?.();
      else onUndo?.();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLocaleLowerCase() === "y") {
      e.preventDefault();
      onRedo?.();
      return;
    }
    const node = findNode(root, selected) ?? focusedRoot;
    const at = ordered.findIndex((p) => p.node.line === selected);

    const go = (p: Placed | undefined) => {
      if (!p) return;
      e.preventDefault();
      setSelected(p.node.line);
    };

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        // 菜单开着时先关菜单 —— 一个 Esc 直接退出整个导图会让人以为按错了
        if (menu) setMenu(null);
        else if (moveSource !== null) setMoveSource(null);
        else if (query) setQuery("");
        else if (focusLine !== null) setFocusLine(null);
        else onClose();
        return;
      case "ArrowDown":
        return go(ordered[at + 1]);
      case "ArrowUp":
        return go(ordered[at - 1]);
      case "ArrowLeft": {
        const p = parentOf(root, selected);
        return go(p ? placedOf(p.line) ?? undefined : undefined);
      }
      case "ArrowRight": {
        if (node.children.length === 0) return;
        if (collapsed.has(nodeKeys.get(node.line) ?? "")) {
          e.preventDefault();
          toggleFold(node.line);
          return;
        }
        return go(placedOf(node.children[0].line) ?? undefined);
      }
      case "Enter":
        e.preventDefault();
        addSibling(node);
        return;
      case "Tab":
        e.preventDefault();
        addChild(node);
        return;
      case "F2":
        e.preventDefault();
        if (node.kind !== "root") beginEdit(node.line);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        remove(node);
        return;
      case " ":
        if (node.children.length > 0) {
          e.preventDefault();
          toggleFold(node.line);
        }
        return;
    }
  };

  return (
    <div
      className={`mindmap${touch ? " is-touch" : ""}`}
      ref={hostRef}
      tabIndex={-1}
      onKeyDown={onKey}
      onPointerDownCapture={(e) => {
        // 画布的 pointerdown 会 preventDefault 来接管平移，所以浏览器不会再替我们
        // 把 textarea blur 掉。捕获阶段先提交，点背景、别的节点、菜单或工具栏都
        // 服从普通就地编辑的预期；只有继续点输入框本身时保持编辑。
        const target = e.target as Element;
        if (editingRef.current !== null && !target.closest(".mm-input")) {
          commitEdit();
          if (target.closest(".mm-canvas") && !target.closest(".mm-node")) {
            requestAnimationFrame(() => hostRef.current?.focus());
          }
        }
      }}
    >
      <header className="mm-bar">
        <span className="mm-title">
          <Icon name="mindmap" size={15} />
          {title}
        </span>
        {/* 拖宽度和右键菜单都没有别的地方能说，只能写在这里 */}
        <span className="mm-tips">
          Enter 加同级 · Tab 加子级 · F2 改字 · Space 折叠 · 右键出菜单 · 拖右边缘改宽度
        </span>
        {/* 触摸屏上另一句：那边既没有键盘也没有右键，写快捷键等于什么都没说 */}
        <span className="mm-tips is-touch">双指缩放 · 拖动平移 · 点节点上的 ⋯ 出菜单</span>
        <label className="mm-search">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            value={query}
            placeholder="搜索节点"
            aria-label="搜索节点"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                cycleSearch(e.shiftKey);
              } else if (e.key === "Escape") {
                e.preventDefault();
                if (query) setQuery("");
                else hostRef.current?.focus();
              }
              e.stopPropagation();
            }}
          />
          {normalizedQuery && <span>{matchOrder.length}</span>}
          {query && (
            <button type="button" onClick={() => setQuery("")} title="清空搜索" aria-label="清空搜索">
              <Icon name="close" size={10} />
            </button>
          )}
        </label>
        <span
          className="mm-tools"
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.preventDefault()}
        >
          <button onClick={() => zoomBy(1 / 1.25)} title="缩小" aria-label="缩小">
            −
          </button>
          <button onClick={() => zoomBy(1.25)} title="放大" aria-label="放大">
            ＋
          </button>
          <button onClick={fit} title="适应窗口">
            适应
          </button>
          <button onClick={() => zoomTo(1)} title="恢复 100% 比例">
            {Math.round(cam.k * 100)}%
          </button>
          <button onClick={onClose} title="回到正文（Esc）" aria-label="关闭思维导图">
            <Icon name="close" size={14} />
          </button>
        </span>
      </header>

      <div className="mm-canvas" ref={canvasRef}>
        {(focusLine !== null || moveSource !== null) && (
          <div className="mm-mode-bar" onKeyDown={(e) => e.stopPropagation()}>
            {focusLine !== null && (
              <>
                <span>仅看：{focusedRoot.text}</span>
                <button onClick={() => setFocusLine(null)}>显示全部</button>
              </>
            )}
            {moveSource !== null && (
              <>
                <span>选择「{findNode(root, moveSource)?.text}」的新父级</span>
                <button onClick={() => setMoveSource(null)}>取消</button>
              </>
            )}
          </div>
        )}
        <div
          className="mm-layer"
          style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}
        >
          <svg className="mm-links" width={view.width} height={view.height + NODE_H}>
            {view.links.map(({ from, to }) => {
              const onPath = activePath.has(from.node.line) && activePath.has(to.node.line);
              const related = hovered === from.node.line || hovered === to.node.line;
              const searchDimmed = normalizedQuery
                && !searchContext.has(from.node.line)
                && !searchContext.has(to.node.line);
              return (
                <path
                  key={`${from.node.line}-${to.node.line}`}
                  className={[onPath ? "is-active" : "", related ? "is-related" : "", searchDimmed ? "is-dimmed" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  data-from={from.node.line}
                  data-to={to.node.line}
                  d={curve(from, to)}
                />
              );
            })}
          </svg>

          {view.nodes.map((p) => {
            const n = p.node;
            const isEditing = editing === n.line;
            return (
              <div
                key={n.line}
                className={[
                  "mm-node",
                  `is-${n.kind}`,
                  // 画得重一点的是**图的根**，未必是那个合成的根节点：
                  // 笔记名让位时，一级标题要接过这身衣服
                  p.depth === 0 ? "is-top" : "",
                  selected === n.line ? "is-selected" : "",
                  activePath.has(n.line) ? "is-path" : "",
                  searchMatches.has(n.line) ? "is-search-match" : "",
                  normalizedQuery && !searchContext.has(n.line) ? "is-dimmed" : "",
                  moveSource !== null && moveSource !== n.line ? "is-move-target" : "",
                  drop?.line === n.line ? `is-drop-${drop.position}` : "",
                  n.done ? "is-done" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-line={n.line}
                style={{ left: p.x, top: p.y, width: p.w }}
                onContextMenu={(e) => {
                  // 编辑框里右键应该是系统的复制 / 粘贴菜单，不能被节点菜单劫走。
                  if ((e.target as Element).closest(".mm-input")) return;
                  e.preventDefault();
                  openMenu(n.line, e.clientX, e.clientY);
                }}
                onPointerEnter={() => setHovered(n.line)}
                onPointerLeave={() => setHovered((line) => line === n.line ? null : line)}
                onDragOver={(e) => {
                  if (dragged === null || dragged === n.line) return;
                  const box = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientY - box.top) / Math.max(box.height, 1);
                  const position: MovePosition = ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "child";
                  if (!editMove(body, root, dragged, n.line, position)) {
                    setDrop(null);
                    return;
                  }
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDrop({ line: n.line, position });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
                }}
                onDrop={(e) => {
                  if (dragged === null || drop?.line !== n.line) return;
                  e.preventDefault();
                  moveNode(dragged, n.line, drop.position);
                }}
              >
                {isEditing ? (
                  <textarea
                    ref={inputRef}
                    className="mm-input"
                    // 非受控：进编辑态时铺一次初值，提交时从 DOM 读回来。
                    // `key` 保证换一个节点时输入框重建，否则会带着上一个的字
                    key={n.line}
                    defaultValue={n.text}
                    spellCheck={false}
                    rows={1}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = "0";
                      el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
                    }}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key.toLocaleLowerCase() === "f") {
                        e.preventDefault();
                        commitEdit();
                        requestAnimationFrame(() => searchRef.current?.focus());
                      } else if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                        e.preventDefault();
                        commitEdit();
                        requestAnimationFrame(() => hostRef.current?.focus());
                      } else if (e.key === "Tab") {
                        // 节点仍是一行 Markdown，Tab 不该把焦点送到顶栏某个偶然的按钮。
                        // 先确认本次编辑，下一次 Tab 才按导图语义新增子级。
                        e.preventDefault();
                        commitEdit();
                        requestAnimationFrame(() => hostRef.current?.focus());
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelCurrentEdit();
                      }
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <>
                    {/* 勾选框自己就是按钮 —— 任务项旁边画一个方框却点不动，
                        谁都会先去点它。它顶替了原来动作栏里那个 ✓ */}
                    {n.kind === "task" && (
                      <button
                        className="mm-check"
                        title={n.done ? "取消勾选" : "勾上"}
                        aria-label="勾选"
                        onClick={() => {
                          const edit = editToggleTask(n);
                          if (edit) onEdit(edit);
                          hostRef.current?.focus();
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {n.done ? <Icon name="check" size={10} /> : null}
                      </button>
                    )}
                    <button
                      className="mm-label"
                      draggable={n.kind !== "root" && !isEditing}
                      title={`${n.text}\n（双击改字，右键出菜单，Ctrl/⌘+点 回到正文第 ${n.line} 行）`}
                      onDragStart={(e) => {
                        setSelected(n.line);
                        setDragged(n.line);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(n.line));
                      }}
                      onDragEnd={() => {
                        setDragged(null);
                        setDrop(null);
                      }}
                      onClick={(e) => {
                        if (moveSource !== null) {
                          if (moveSource !== n.line) moveNode(moveSource, n.line, "child");
                          return;
                        }
                        // Ctrl/⌘+点 = 回到正文那一行。和文档树里「在新标签打开」
                        // 同一个手势习惯
                        if ((e.ctrlKey || e.metaKey) && n.kind !== "root") onGoto(n.line);
                        else {
                          setSelected(n.line);
                          hostRef.current?.focus();
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                      }}
                      onDoubleClick={() => {
                        if (n.kind !== "root") beginEdit(n.line);
                      }}
                    >
                      <span className="mm-text">{n.text || "（空）"}</span>
                    </button>
                  </>
                )}

                {/* 右边缘完整留给拖宽。折叠走 Space / 右键菜单 / 触屏上的 ⋯；
                    收起后只用一个被动数字说明还有内容，不再让按钮和拖杆抢位置。 */}
                {p.collapsed && (
                  <span
                    className="mm-collapsed-count"
                    title={`已隐藏 ${subtreeSize(n) - 1} 个后代节点`}
                    aria-label={`已隐藏 ${subtreeSize(n) - 1} 个后代节点`}
                  >
                    +{subtreeSize(n) - 1}
                  </span>
                )}

                {/* 节点上只留这一个按钮，而且**只在没有右键的设备上出现**
                    （CSS 里按 `hover: none` 和 `.is-touch` 两条判）—— 桌面上
                    右键就是菜单，几十个节点各挂一排图标，先看见的是按钮不是内容 */}
                <span className="mm-acts">
                  <button
                    onClick={(e) => {
                      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      openMenu(n.line, box.left, box.bottom + 4);
                    }}
                    title="更多动作"
                    aria-label="更多动作"
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Icon name="more" size={11} />
                  </button>
                </span>

                {/* 右边缘只拖当前节点的宽度，双击只复原当前节点 */}
                <span
                  className="mm-resize"
                  onPointerDown={(e) => startResize(e, n.line)}
                  onDoubleClick={() => resetWidth(n.line)}
                  title="拖动改这个节点的宽度（双击复原）"
                />
              </div>
            );
          })}
        </div>
      </div>

      {menu && menuNode && (
        // 和文档树的右键菜单同一套材质（`.ctx`）—— 界面上只该有一种浮层的样子。
        // 按下不能往上冒：外面那个 pointerdown 会先把菜单关掉，click 就没了
        <ul
          className="ctx mm-menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {menuNode.kind !== "root" && (
            <li>
              <button onClick={act(() => beginEdit(menuNode.line))}>改字</button>
            </li>
          )}
          <li>
            <button onClick={act(() => addChild(menuNode))}>加子级</button>
          </li>
          {menuNode.kind !== "root" && (
            <li>
              <button onClick={act(() => addSibling(menuNode))}>加同级</button>
            </li>
          )}
          {menuNode.kind === "task" && (
            <li>
              <button
                onClick={act(() => {
                  const e = editToggleTask(menuNode);
                  if (e) onEdit(e);
                })}
              >
                {menuNode.done ? "取消勾选" : "勾上"}
              </button>
            </li>
          )}
          {menuNode.children.length > 0 && (
            <li>
              <button onClick={act(() => toggleFold(menuNode.line))}>
                {collapsed.has(nodeKeys.get(menuNode.line) ?? "")
                  ? `展开（${subtreeSize(menuNode) - 1}）`
                  : "折叠"}
              </button>
            </li>
          )}
          {menuNode.children.length > 0 && menuNode.line !== focusedRoot.line && (
            <li>
              <button onClick={act(() => {
                setFocusLine(menuNode.line);
                setSelected(menuNode.line);
              })}>
                只看这一支
              </button>
            </li>
          )}
          {menuNode.kind !== "root" && (
            <>
              <li className="is-sep">
                <button
                  disabled={parentOf(root, menuNode.line)?.children[0]?.line === menuNode.line}
                  onClick={act(() => siblingMove(menuNode, -1))}
                >
                  上移
                </button>
              </li>
              <li>
                <button
                  disabled={(() => {
                    const siblings = parentOf(root, menuNode.line)?.children ?? [];
                    return siblings[siblings.length - 1]?.line === menuNode.line;
                  })()}
                  onClick={act(() => siblingMove(menuNode, 1))}
                >
                  下移
                </button>
              </li>
              <li>
                <button onClick={act(() => setMoveSource(menuNode.line))}>移动到…</button>
              </li>
              <li>
                <button onClick={act(() => onGoto(menuNode.line))}>回到正文这一行</button>
              </li>
              {/* 删除单独隔开：手指点这一列的命中率本来就低，而它上面
                  几条都是「点错了再点回来」，只有它不是 */}
              <li className="is-sep">
                <button className="ctx-danger" onClick={act(() => void remove(menuNode))}>
                  删除
                </button>
              </li>
            </>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * 父到子的连线。
 *
 * 用三次贝塞尔而不是折线：折线在深层级里会叠成一片直角网格，看着像电路图；
 * 曲线一眼能跟着看到哪一支是哪一支。控制点取水平中点，所以出入两端都是水平的。
 */
function curve(from: Placed, to: Placed): string {
  // 节点宽度可以拖，不能继续拿默认的 NODE_W 算锚点；否则变宽后线会从框内冒出来。
  const x1 = from.x + from.w;
  // 从各自的中线出发 —— 换行之后两端高矮不一，用固定的半高会连到边框外面
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}
