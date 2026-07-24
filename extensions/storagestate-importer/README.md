# AutoVis 登录态采集器（Chrome 插件）

在**你自己的真浏览器**里采集目标站点的登录态（cookies + localStorage），一键导入 AutoVis 的
`auth_profile_states`。后续业务回放沿用现成的 storageState 注入逻辑，**业务脚本 0 改动**。

## 为什么需要它

像 `item.taobao.com` 详情页这类强风控站点，会对部署机的**机房 / 陌生出口 IP** 触发 punish 页
（`detected unusual traffic from your network`），即便人工滑过滑块也会返回 `FWqx` 被否决——
因为决定性因素是「IP 信誉 + 设备信任」，不是滑块本身。

而你本机的浏览器用的是**住宅 IP + 长期被站点信任的设备指纹 + 浏览历史**，详情页对你本来就放行。
所以在本机采集登录态，再注入回 AutoVis，是对这类站点最可靠的路径（绕开 punish，而不是去打赢它）。

## 安装（开发者模式加载）

1. Chrome 打开 `chrome://extensions/`
2. 右上角打开「开发者模式 / Developer mode」
3. 点「加载已解压的扩展程序 / Load unpacked」，选择本目录
   `autovis-runner/extensions/storagestate-importer/`

## 使用

1. 在本浏览器里**正常登录**目标站点（如 epicgames / 淘宝），并停在登录后的页面上。
2. 点插件图标，填 **AutoVis 运行机地址**（如 `http://172.23.31.219:8787`），点「连接」。
   - 若服务端开了鉴权：先在**同一个浏览器**里登录一下 AutoVis（之后免填 Token），
     或在「会话 Token」栏填入登录 AutoVis 后的会话值，再点连接。
3. 连接成功后，**项目 / 登录状态 Profile / 目标网址**都变成下拉框，直接选即可（不用再抄 ID）。
   - 目标网址留空＝写到项目主域名行。
   - 采集 cookie 的域名已按当前标签页自动填好，一般不用改。
4. 点「采集当前页面登录态并导入」。成功后回 AutoVis 用「检查登录状态」验证即可。

> 上次填的地址 / 项目 / Profile 会记住，下次打开自动连接并选好。Token 不会被保存。

## 限制与说明

- **localStorage 只采集当前标签页所在 origin** 的（localStorage 按 origin 隔离）。淘宝主要登录态在
  cookie 上，通常足够；若某站点关键状态在别的 origin 的 localStorage，需要在那个页面再采一次。
- **cookies 按域名采集**：插件会用 `chrome.cookies.getAll({ domain })` 抓该域名及其子域名下的全部
  cookie。请确保把站点用到的主域名都填上（淘宝是 `taobao.com` + `tmall.com`）。
- 插件需要 `cookies` 权限和 `<all_urls>` 主机权限（跨域名采 cookie + 往运行机直传）。
  仅本地加载、不上架，权限只作用于你本机。
- 鉴权部署：若服务端开了鉴权，插件会把你填的 Token 作为 `autovis_session` cookie 写到运行机域名后再
  带 `credentials` 提交。Token 即你登录 AutoVis 后的会话值。

## 服务端配套接口

`POST /api/auth-profiles/:profileId/states/import`

```jsonc
{
  "projectId": "project-xxxx",
  "targetUrlId": "target-url-xxxx", // 可选，省略落主域名行
  "storageStateJson": "{\"cookies\":[...],\"origins\":[...]}",
  "postLoginUrl": "https://item.taobao.com/item.htm?id=..." // 可选
}
```

返回写入后的 `AuthProfileState`（含 `storageStateSummary`）。
