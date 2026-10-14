/**
 * 每个测试文件一份自己的 localStorage。
 *
 * 浏览器测试的各个文件在同一个页面的不同 iframe 里**并行**跑，同源，于是
 * 默认共用一份 localStorage。App 启动时从那里读一串界面偏好（侧栏显示哪个
 * 面板、终端和 AI 面板开没开…），而好几个测试会写这些键：A 文件刚写下
 * `verso.sidebarView = "outline"`，B 文件恰好在这一刻挂载 App，侧栏里就
 * 不是文档树 —— B 干等五秒「树还是空的」，失败信息和真正的原因毫无关系，
 * 而且只在整套并行跑、文件恰好排到一起时才出现（拖动排序那组测试就这样
 * 时好时坏）。
 *
 * 换成一个只属于这个 iframe 的内存实现，各文件互不可见。文件内部照旧共用
 * 一份 —— 那是各测试自己 `beforeEach` 里 `clear()` 管的事。
 */
const store = new Map<string, string>();

const memory: Storage = {
  get length() {
    return store.size;
  },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k)! : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};

Object.defineProperty(window, "localStorage", { value: memory, configurable: true });
