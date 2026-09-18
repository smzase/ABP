# Mikan 发布 API 文档

## 概述
* Mikan 发布 API 允许用户通过 HTTP POST 请求来发布新番剧集的 Torrent 文件。
* 本 API 支持上传文件、填写相关信息以及自定义 Trackers 和描述等内容。
* 请确保每次请求时使用正确的 API Token。

## 请求 URL
POST `https://api.mikanani.me/api/episode`

## 请求头
* **Content-Type**: `application/json`
* **Authorization**: `MikanHash xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

**详细说明**：
* **Content-Type**: 请求体的数据格式，必须为 `application/json`。
* **Authorization**: API Token，格式为 `MikanHash` 加上空格和您的 API Token。API Token 可以登录后在 `https://mikanani.me/Account/ApiLogin` 找到（每次访问动态生成，生成的 token 可以重复使用），或者使用管理员分配给你的长效 token。

## 请求参数
请求体使用 JSON 格式，参数如下：

| 参数名称 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| **name** | String | 是 | 剧集名称，必须包含，此项目会被用来自动匹配 Bangumi 番剧和发布组。例如：`[猎户压制部]我要【招架】一切~反误解的世界最强想成为冒险者~/ Ore wa Subete wo Parry suru [06] [1080p] [繁日内嵌] [2024年7月番][411.3 MB]`。 |
| **torrentBase64** | string | 是 | Base64 编码后的 Torrent 文件。 |
| **trackers** | string[] | 否 | 可选的 Tracker 列表。如果未提供，我们将为您的种子文件自动添加10个最常用的 Tracker。 |
| **description** | String | 否 | 可选的描述信息，支持 BBCode 格式。您可以在此处添加图片、简介、下载链接、交流群等。 |
| **bangumiId** | Int | 否 | 可选的 Bangumi 番剧 ID，与 `subtitleGroupId` 必须同时提供，单独提供时将不会生效。我们将使用你的 `bangumiId` 和 `subtitleGroupId` 覆盖自动识别。可以使用 `https://api.mikanani.me/api/bangumi/search/<keyword>` 查询番剧对应的 id。 |
| **subtitleGroupId**| Int | 否 | 可选的字幕组 ID，与 `bangumiId` 必须同时提供，单独提供时将不会生效。可以使用 `https://api.mikanani.me/api/subtitleGroup/search/<keyword>` 查询字幕组对应的 id。 |
| **publishGroupId** | Int | 否 | 可选的发布组 Id。可以使用 `https://api.mikanani.me/api/publishGroup/search/<keyword>` 查询发布组对应的 id。 |

## 示例请求
以下是一个使用 `fetch` 函数发送请求的 JavaScript 代码示例：

```javascript
import fs from "node:fs/promises";
const torrentFile = await fs.readFile("t.torrent");
const url = "[https://api.mikanani.me/api/episode](https://api.mikanani.me/api/episode)";
const res = await fetch (url, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        // query from [https://mikanani.me/Account/ApiLogin](https://mikanani.me/Account/ApiLogin) (need cookie) or use the one provided by admin. Will migrate to OAuth2 later.
        Authorization: "MikanHash xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
    body: JSON.stringify({
        name: "[LoliHouse] 多数欠/ Tasuuketsu 04 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]",
        // if you only do not provide subtitleGroupId and bangumild, they will be inferred from name
        // subtitleGroupId: 370, // query from [https://api.mikanani.me/api/subtitleGroup/search/](https://api.mikanani.me/api/subtitleGroup/search/)<keyword>
        // bangumild: 3361, // query from [https://api.mikanani.me/api/bangumi/search/](https://api.mikanani.me/api/bangumi/search/)<keyword>
        description: "can use bbcode",
        torrentBase64: torrentFile.toString("base64"),
        // more than 10 trackers will be ignored
        trackers: ["udp://tracker.opentrackr.org:1337/announce"],
        // if you want to publish for other group, use the publishGroupId
        // publishGroupId: 223, // query from [https://api.mikanani.me/api/publishGroup/search/](https://api.mikanani.me/api/publishGroup/search/)<keyword>
    }),
});
console.log(res.status);
if (res.status !== 200) {
    console.log(await res.text());
}
```

## 返回值
* 成功: 返回 200 状态码。
* 失败: 返回 4xx 或 5xx 状态码，同时返回错误信息。

## 错误处理
若请求失败，请检查以下内容：
* 是否提供了正确的 name 和 torrentBase64。
* 是否使用了有效的 token。
* 可选参数（如 bangumiId 和 subtitleGroupId）是否符合要求。

## 注意事项
* 每个请求必须包含 name 和 torrentBase64。
* tracker 字段最多接受 10 个 Tracker，超过部分将被忽略。
* Description 支持 BBCode，可以添加图片、链接和其他格式化内容。
* 提供的 bangumiId 和 subtitleGroupId 必须同时存在，单独提供时不会生效。