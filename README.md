# AniBT Publish (ABP)

AniBT 站点（[anibt.net](https://anibt.net)）的动画资源发布桌面客户端。
支持 Windows / macOS / Linux，仅支持动画（Anime）分类发布。

## 功能

- **发布向导**：多选/拖拽上传 `.torrent`，自动识别番剧模板、字幕语言、格式、字幕类型；
  逐个配置分辨率（360p–4K+自定义）、格式（MKV/MP4+自定义）、字幕类型（外挂/内封/内嵌/无）、
  字幕语言（CHS/CHT/JP/EN+自定义）；「下一步」进入最终修改（标题/版本/自定义标签可拖拽排序/Markdown 简介）
- **番剧模板**：标题模板（`{{ep}}` `{{subtitleLangZh}}` 等 20+ 变量，点击插入、分类折叠）、
  简介模板、番剧模板（Bangumi 搜索或手动 bgmId；繁体中文名一键繁化姬转换；发布组绑定；Nyaa 代发默认开关）
- **站点账号**：组管理 + API Key 保存与检查（whoami / scopes 展示）
- **发布记录**：按番剧分组或列表展示，懒加载；Key 含 `releases:delete` scope 时可删除发布
- **设置**：字幕识别词库（预设可改删、自定义归类简/繁）、代理（系统/直连/自定义 HTTP·HTTPS·SOCKS5，含测试）
- **其他**：无边框自绘标题栏；深浅色（`#fafafa` / `#191a1b`）+ 主题色多选/自定义；
  简中/繁中/English i18n；Preview 测试发布；Nyaa 代发（站点白名单制，本地不直连 Nyaa）

## 技术栈

Electron · Vue 3 · TypeScript · electron-vite · Tailwind CSS v4 · shadcn 约定（reka-ui）·
md-editor-v3 · pinia · vue-i18n · electron-builder

## 配置文件位置

| 平台 | 路径 |
| --- | --- |
| Windows | `文档\AniBT Publish\`（含 portable 单 exe 版） |
| macOS | `~/Library/Application Support/AniBT Publish/` |
| Linux | `~/.config/anibt-publish/`（遵循 `$XDG_CONFIG_HOME`） |

目录下两个文件：

- `config.json` —— 普通配置（主题、语言、代理、模板、发布记录），**不含任何 API Key**
- `secrets.json` —— 站点 API Key，AES-256-GCM 加密。密钥由应用内口令派生，所以文件
  「随身携带」：portable 单 exe 连配置一起拷到别的机器仍能解开。
  注意这属于**混淆级**保护 —— 能防明文泄露（截图、网盘同步、误提交仓库），
  防不住拿到 exe 逆向的人。

## 开发

```bash
npm install
npm run dev
```

## 验证与打包

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run probe         # 真窗口 UI 探针（断言那些 lint 看不见的 UI 不变量）
npm run pack:win      # Windows：NSIS 安装包 + portable 单 exe
npm run pack:mac      # macOS：dmg + zip
npm run pack:linux    # Linux：AppImage + deb
node scripts/smoke-test.mjs
```

CI：在 GitHub **Actions → Build Artifacts → Run workflow** 手动触发三端构建。
通过检查和打包后，在该次运行页面的 **Artifacts** 下载 `anibt-publish-win`（NSIS + portable）、
`anibt-publish-mac`（x64 / arm64 的 dmg + zip）或 `anibt-publish-linux`（AppImage + deb）。
产物保留 14 天，只包含安装包，不含 node_modules；不会创建或更新 GitHub Releases，推送 tag 也不会自动运行。

## 文档

- 代理协作约定：[AGENTS.md](./AGENTS.md) / [CLAUDE.md](./CLAUDE.md)
- AniBT API：https://wiki.anibt.net/docs
