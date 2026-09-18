# CLAUDE.md

本文件与 AGENTS.md 保持一致，给 Claude 系代理的快速指引。

## 一句话

AniBT Publish (ABP)：Electron + Vue 3 + TS 的 AniBT 站点动画发布客户端，三端。
详细约定读 [AGENTS.md](./AGENTS.md)，两者冲突时以 AGENTS.md 为准。

## 上手命令

```bash
npm install        # 装依赖
npm run dev        # 开发调试
npm run typecheck  # 类型检查（node + web 双配置）
npm run lint       # ESLint
npm test           # shared 纯逻辑单测
npm run build      # electron-vite 构建
npm run probe      # 真窗口 UI 探针（跑前先 build）
npm run pack:win   # Windows 打包（NSIS 安装包 + portable 单 exe）
```

本机 `ELECTRON_RUN_AS_NODE=1` 在环境里，会让 `electron.exe` 退化成 node
（`require('electron')` 返回路径字符串、`app` 是 undefined）。跑探针/打包前先清掉：

```powershell
$env:ELECTRON_RUN_AS_NODE=$null; $env:NODE_OPTIONS=""
```

## 关键路径

- IPC 契约：`src/shared/types.ts`（`IpcChannels`）—— 加通道先改这里
- 纯逻辑：`src/shared/`（模板引擎 `template.ts`、字幕识别 `subtitle-detect.ts`、
  bencode `bencode.ts`、文件名解析 `parse-name.ts`、密钥加解密 `secrets-crypto.ts`、
  IPC 序列化 `plain.ts`、发布前体检 `publish-validate.ts`）
  —— 只用可擦除 TS 语法，node 直接跑单测
- AniBT API 封装：`src/main/anibt.ts`
- 本地直发：`src/main/local-publish.ts`；隔离网页登录：`src/main/site-login.ts`；
  Markdown 格式转换：`src/shared/description-format.ts`
- 配置目录规则：`src/main/paths.ts`（Win: `Documents/AniBT Publish`）
  - `config.json` 普通配置；`secrets.json` 站点 API Key（AES-256-GCM，随文件走）
- UI 组件：`src/renderer/src/components/ui/`（shadcn 约定手写，无 CLI）
  - 下拉框 `UiSelect` + `UiSelectItem`；确认弹窗 `lib/confirm.ts` 的 `confirm()`
  - 动效关键帧在 `styles/main.css`（Tailwind v4 不带 `animate-in` 那套，得手写）
- Markdown 编辑器：只用 `components/ui/UiMarkdownEditor.vue`，别直接 import `MdEditor`
- 打包白名单：`electron-builder.yml`（产物不含 node_modules / 源码 / 文档）

## 红线

- API Key、API Token、账号密码、Cookie、User-Agent 只存本地 `secrets.json`（加密），
  不进 `config.json`、不进仓库、不进日志
- `dependencies` 保持为空（全部 bundle，asar 无 node_modules）
- 不在标题栏写项目名；不改配置目录位置；shared 层不引入 Electron/DOM API
- 外观默认**浅色**（`#fafafa`）；`index.html` 上不要留 `class="dark"`

## 本地直发约定

- 标题栏 `AniBT / 本地`：AniBT 是默认主发布，本地是备用直发；发布记录按模式隔离。
- 支持 8 站：AniBT、蜜柑计划、Nyaa、动漫花园、末日动漫、AcgnX、萌番组、ACG.RIP。
  AniBT 用 API Key；蜜柑用 MikanHash Token；Nyaa 仅使用账号密码调用 `/api/upload`
  Basic Auth API，不保留网页登录 Cookie 后备；动漫花园/萌番组支持账号密码登录、隔离
  网页手动登录和按站清 Cookie（动漫花园在应用内获取图片验证码并提交 `/user/login`，只有
  “打开网页登录”才创建独立窗口；萌番组调用 signin API）；
  末日动漫/AcgnX 用 UID + API Token；ACG.RIP 用 API URL + `X-API-TOKEN`，输入既支持
  裸 Token 也支持 `tpx://acg.rip/<token>`，请求前必须剥离前缀。
- 简介源始终为 Markdown：AniBT/Nyaa 原样；动漫花园/末日动漫/AcgnX/萌番组转 HTML；
  蜜柑转 BBCode；ACG.RIP 用 `[markdown]` 与 `[/markdown]` 包裹。
- 蜜柑的 `bangumiId` 不是 bgm.tv 的 `bgmId`；与 `subtitleGroupId` 成对发送。
  **无视蜜柑文档的可选 `trackers`：请求体永远不发送该字段。**
- 失败的本地发布会把种子缓存到 `pending-torrents`，供记录页单站/多站重试；
  全部成功后才删除。
- 凭据检查不能把“HTTP 可达”冒充认证成功：ACG.RIP、末日动漫、AcgnX 都没有无副作用
  的独立验证接口，配置完整后显示“实际发布时验证”，禁止向上传端点发送缺字段的空 POST。
- 代理全量检测八站并发发起、逐行即时回写；单站检测只锁当前行按钮。

## 反复踩过的坑（详见 AGENTS.md 第 9–23 条）

1. `TooltipProvider` 必须包住整棵树（在 `App.vue`）。reka-ui 的 `TooltipRoot` 缺少它会抛
   注入错误，Vue 随后把那段子树渲染成**空**—— lint/typecheck/单测全绿但按钮没了。
2. md-editor-v3 默认**从 unpkg.com 现场拉 script**；`instance: null` 关不掉，那正是触发条件。
   只有 `no-highlight` / `no-katex` / `no-mermaid` / `no-echarts` / `no-prettier` /
   `no-upload-img` 这些 props 有效，且工具栏别放 `fullscreen`。已封装在 `UiMarkdownEditor.vue`。
   另外它的预览默认 500ms 防抖（`renderDelay`），`lib/markdown.ts` 里已改成 0。
3. 受控输入框不能吞键入。`:model-value` + `@update:model-value` 是全受控的，处理函数拒绝某个值
   （`Number()` 解析失败、越界、`.trim()`、`.toUpperCase()`）Vue 就会把 DOM 弹回旧值，
   用起来就是「能删、打不进去」。数值/需要规范化的字段用一份原始文本 `ref`，失焦再规范化。
4. **不准用 `window.confirm` / `alert` / `prompt`**。那是系统模态框，关掉之后键盘焦点回不到
   webContents，之后整个窗口的输入框都变成「能删、打不进去」（和第 3 条同样的症状，
   但成因完全不同）。用 `lib/confirm.ts` 的 `confirm()`。
5. **Tailwind v4 没有 `animate-in` / `fade-in-0` / `zoom-in-95`**。那是 v3 时代
   `tailwindcss-animate` 插件的东西，v4 里这些 class 不生成任何 CSS ——
   写了等于没写（全应用没动画就是这么来的）。动效在 `main.css` 手写：
   `@keyframes` + `@theme inline` 里对应的 `--animate-*` 变量，**两半都要加**。
6. **下拉框一律用 `UiSelect` + `UiSelectItem`，不准用原生 `<select>`/`<option>`**。
   原生的弹出的是操作系统列表：直角、系统配色、不跟主题、没动画。
   占位文案走 `placeholder` 属性（reka-ui 把空字符串留给「清空选中」了）。
7. **Tailwind v4 的 `translate` 是独立属性，不在 `transform` 里**。
   `-translate-x-1/2` 编译成 `translate: ...`，关键帧里再写 `transform: translate(-50%,-50%)`
   会**叠加**成 -100%，弹窗就先闪现在左上角再跳回中间。
   居中元素的关键帧只动 `scale` / `opacity`。
8. **确认弹窗的按钮别用 `AlertDialogAction` / `AlertDialogCancel` 包**。
   它们自带关闭处理，会和按钮自己的 `@click` 抢顺序；reka 的先跑就会触发
   `onOpenChange(false)` 把 Promise 抢先结算成 false ——「点了确认删除却没删掉」。
   用普通按钮显式 `settleConfirm()`。**确认和取消两条路都要测**，
   只测取消的话确认坏了也是全绿。
9. **reka-ui 对合成事件挑食，探针要发真实输入事件**。`SelectTrigger` 听的是
   `pointerdown`，`el.click()` 压根打不开弹层；选项即使收到 dispatch 出来的
   `pointerdown` 也只是高亮、不会真的选中。探针里开下拉用 `openSelectByText`，
   点选项用 `clickElementAt`（`sendInputEvent` 打真实坐标）。
   **探针报错先用真实鼠标复现一遍**，别急着改产品代码 —— 上一轮就差点把好的功能「修」坏。
10. **`TooltipTrigger` 即使 disabled 也照样带 `data-state="closed"`**，
    靠这个属性判断「有没有挂气泡」是错的。要断言行为：把鼠标移上去数 `[role=tooltip]`。
    侧边栏两个方向都要测 —— 展开时不该弹（字就在按钮上），收起时必须弹（只剩图标）。
11. **响应式对象不能直接送进 `window.api.*`**。`reactive`/`ref` 是 Proxy，
    结构化克隆不认，抛 `An object could not be cloned.` —— payload 里十几个字段
    全是普通字符串，只要有一个是从 store 直接取的数组（`entry.languages`）就整个炸，
    报错还不说是哪个字段。一律用 `shared/plain.ts` 的 `toPlain()` 包一层
    （**别**用在二进制上，Uint8Array 会被 JSON 拍成 `{"0":…}`）。
12. **跨页面的 UI 状态放 store，别放组件**。切路由会卸载组件，局部 `ref` 跟着归零 ——
    「Preview 开关开了，去别的页面转一圈回来自己关了」就是这么来的。
    控件描述的是哪份数据，就跟那份数据放一起。
13. **探针不准发真实网络请求**。它是无人值守跑的，「反正会 401」也意味着
    真把种子和 API Key 发给了 anibt.net。IPC 那头的 bug，就断言这头能验的部分
    （payload、产物里的守卫），机制本身交给 `run-checks.mjs`。
14. **发布接口：空字段一律别发**。空串不是「用默认值」，站点当成一个显式的非法值校验，
    回一句 `422 Invalid request body` 且**不点名字段**。枚举是封闭的
    （见 `shared/constants.ts` 的 `API_*`），而分辨率/格式下拉留了「自定义」入口，
    用户能打进 `1440p`、`MOV` 这种站点不认的值 —— 发之前先过
    `shared/publish-validate.ts`。错误原因要写在行里，别只塞 `title` 悬停提示。
15. **探针里等条件，别等时间**。固定 `sleep` 是这条探针最大的不稳定来源，而且失败会**串**：
    弹窗晚关一拍，遮罩还在，后面几次点击全落在遮罩上，报出来的却是三条之后
    某个名字完全不相干的断言。用 `waitFor`；`clickElementAt` 也要在发事件前
    重新取一次坐标（中间任何重渲染都会让旧坐标指到别处）。
16. **站点文档在开发机上够得着**：`https://wiki.anibt.net/llms.txt` 是索引，
    每页都有 `.md` 版本（如 `/en/docs/open-api/reference.md`）。对着契约改，别猜。

## 领域约定（改之前先读 AGENTS.md「Domain conventions」）

- 语言顺序恒为 `CHS/CHT/JP/EN`，统一走 `constants.ts` 的 `sortLanguages()`
- `CHI`/`ZH` = 中文不分简繁 → `CHS+CHT`；`CHI_JPN` 是 `CHS+CHT+JP`
- 字幕词库**不收单个汉字**（「日」「英」会把《夏日重现》《我的英雄学院》全带歪）
- `{{titleZhHans}}`/`{{titleZhHant}}` 是明确的简/繁；`{{titleZh}}` 跟着标题变体走。
  变量名大小写不敏感
- 新建番剧模板的标题模板与简介**一律空白**，`sanitizeAppData` 也不准回填

改完 UI 记得 `npm run build && npm run probe` —— 上面这几类问题只有真窗口能抓到。
