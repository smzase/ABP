/**
 * IPC 序列化：把 Vue 的响应式对象拍回普通对象。
 *
 * 为什么需要它：Vue 的 `reactive` / `ref` 返回的是 **Proxy**，而 Electron 跨进程
 * （contextBridge / ipcRenderer.invoke）走的是结构化克隆算法 —— 它不认 Proxy，
 * 直接抛 `DataCloneError: An object could not be cloned.`。
 *
 * 坑在于这个错误离现场很远：payload 里十几个字段全是普通字符串，只要有**一个**
 * 是从 store 里直接取出来的数组（`entry.languages`），整个调用就炸，
 * 而报错信息里完全看不出是哪个字段的问题。
 *
 * 所以约定：**任何送进 window.api.* 的对象，先过一遍 toPlain。**
 * 配置类数据本来就是 JSON-safe（字符串/数字/布尔/数组/纯对象），
 * 一次 JSON 往返既解掉 Proxy 也顺手丢掉 undefined。
 *
 * 注意：不能拿它处理二进制（Uint8Array 会被 JSON 变成 `{"0":1,...}`）。
 * 种子字节那条路径本来就传的是新建的 Uint8Array，不是响应式对象，不用也不该过这里。
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
