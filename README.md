<div align="center">

<img alt="SPlayer-Next logo" width="120" height="120" src="build/icon.png" />

</div>

# AniBT Publish（ABP）

> ### **欢迎各个字幕组入驻** [**AniBT.net**](https://anibt.net/)
> ### 本站提供 **Nyaa 代发服务**，若您需要往 Nyaa 发布资源，欢迎您前来使用！

基于 AniBT 站点制作的一款本地发布客户端，在 AniBT 网页上设置好 **站点同步** 后，他们会帮您将资源同步到各个 BT 站。（注：AniBT 没有被墙）

不过，本客户端也支持**本地直发各个 BT 站**，支持 **ACG.RIP、AniBT、动漫花园、萌番组、Mikan（蜜柑计划）、末日动漫、Nyaa**。

本客户端轻松上手，旨在为字幕组发布人员更方便地发布资源。

**当前正在测试中，仅支持动画分类发布，暂时只考虑中文字幕组适配，有问题还请多多反馈！**

## 上手说明

## 客户端截图

![发布](assets\发布.webp)
![番剧模板](assets\番剧模板.webp)
![标题模板](assets\标题模板.webp)
![站点账号](assets\站点账号.webp)

## 验证与打包

安装依赖并验证：

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run probe
```

按目标平台打包，产物位于 `release/`：

```bash
npm run pack:win      # Windows：Setup + portable
npm run pack:mac      # macOS：DMG + ZIP
npm run pack:linux    # Linux：AppImage + deb
npm run smoke        # Windows 产物启动测试
```

## 致谢

非常感谢以下项目为 AniBT Publish 的制作提供灵感和功能实现

- [EasyPublish](https://github.com/vcb-s/EasyPublish) ——  BT 站登录方案
- [One-Key-Publish](https://github.com/AmusementClub/OKP) ——  BT 站登录方案
- [Nyaapi](https://github.com/Kylart/Nyaapi) ——  Nyaa 发布 API
- 