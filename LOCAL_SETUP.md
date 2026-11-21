# 墨色江湖本地版

本地站点放在 `D:\墨色江湖\墨色江湖本地版`。网页使用的 API 工作流在 `data/localMoodyKrea2Workflow.json`；ComfyUI 左侧列表使用的节点版工作流在 `D:\ComfyUI\ComfyUI\user\default\workflows\墨色江湖`。

本副本来自 bacon159 的 `MoRanJiangHu` 仓库，供本机网页连接本机 ComfyUI 使用。没有修改官方在线站点。

## 启动

平时可从 `D:\studio` 私人小站首页的"墨色江湖"卡片查看状态、按需启动/停止并打开本地网页；小站启动本服务时也会先检查 GitHub 更新。

1. 先确认 ComfyUI 在本机 `127.0.0.1:8188` 运行。2. 双击 `start-local.cmd`。它会先检查 GitHub 上 `main` 是否有变化，并在启动窗口提示；检查失败也会继续启动网站，不会自动改动本地代码。如果网站已经运行，脚本会提示直接打开网页。启动窗口保持打开期间，在 Edge 访问 `http://127.0.0.1:3000/`。上次结果保存在 `local-logs/update-status.json`。仅刷新浏览器页面不会重新检查更新。3. 首次创建的本地普通生图和 NSFW 接口设置都会预填 ComfyUI 地址 `http://127.0.0.1:3000/local-comfy`，并使用 `data/localMoodyKrea2Workflow.json`。没有设置开机自启。

如果浏览器已保存过本地站点设置，预设不会覆盖它。可在"文生图设置 → 普通接口"手动选择 ComfyUI，填写上述 API 地址、留空 API Key，关闭"使用默认工作流"，上传 `data/localMoodyKrea2Workflow.json`；再到"NSFW 接口"启用独立接口，填写同一地址、留空 API Key，关闭"使用默认工作流"，上传同一文件，最后保存配置。该文件是玩家提供的 10 节点 API 工作流，只将缺失的底模名改为本机已有的 `moodyKrea2Mix_v70_nvfp4.safetensors`；原下载文件保留不变。

本地网页只监听 `127.0.0.1:3000`；其他 ComfyUI 代理固定连接本机 `127.0.0.1:8188`，仅转发出图所需的 `/system_stats`、`/prompt`、`/history/{id}` 和 `/view`。本地地址和线上站点的浏览器存档互不相通。

## GitHub 云同步

本地站点的"云端同步 → GitHub"使用这台电脑已登录的 GitHub CLI 账号。当前已验证账号是 `Jiang-Xiaoxing`；网页不会接收或保存 CLI 令牌。若今后本机 GitHub 登录失效，先在终端运行 `gh auth login`，再重新打开本地网页。线上站点的 GitHub OAuth 登录与本地网页按域名隔离，不能自动共享登录状态。

首次使用时，在"目标私有仓库"填入 `wuxia-cloud-save` 并绑定。绑定和查看云端记录只读 GitHub，不会创建仓库或上传存档；点击"上传到 GitHub 云端"并确认后才会创建私有仓库、Release 和备份附件。下载会覆盖本机存档与设置，按页面确认操作。若要在在线站点恢复这份备份，需在那里登录同一个 GitHub 账号、填写相同仓库名，再手动下载。

截至本次接入前，这个账号下未找到墨色江湖云存档 Release；之前仅完成 GitHub 授权不代表已有云备份。本机 ComfyUI 地址和工作流属于设置的一部分，上传完整备份后，其他设备恢复时需要重新配置其生图接口；从云端恢复到本机后也应检查 ComfyUI 设置。

在线版现有的 7 条存档已通过页面"导出全部存档"备份到 `local-logs/backups/`；本地版的完整设置也已在同一目录备份。该目录被 Git 忽略，备份文件不会随项目代码提交。云端仍需在页面上明确执行上传，单纯绑定仓库不会产生云备份。
