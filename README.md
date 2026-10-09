# LazyBot

部署在 VPS 上的 Discord 角色扮演 bot，所有配置通过手机网页后台完成，保存即生效。

- 人设、上下文、主动插话、模型可按 全局 / 服务器 / 频道 分层配置，每层可选继承
- 服务器总记忆 + 群友个人记忆，选区间总结、确认后写入，带版本历史和回滚，各服务器互不串
- 上下文中群友以 `[服务器昵称-用户名-用户ID]` 标识，记录曾用名，带时间戳
- 被 @ / 被回复时回答；可配置概率、冷却、次数上限的主动插话（小模型先判断）
- 自动给所有服务器的表情打标签，按使用频率挑选候选表情点反应
- 支持 OpenAI 兼容格式与 Claude 格式，按用途分配模型，主模型失败自动切换备用
- 私聊白名单、三种私聊模式（`!mode` 指令切换）
- 用量统计、实时日志、报错记录

## 部署

VPS 需要已安装 Docker。

```bash
curl -fsSL https://raw.githubusercontent.com/skaria1267/discordlazybot/main/deploy/install.sh -o install.sh && bash install.sh
```

脚本会询问域名、后台密码，并让你粘贴 Cloudflare 源服务器证书和私钥，然后自动配置 Nginx 并启动容器。

常用命令：

```bash
lazybot update    # 拉取最新镜像并重启
lazybot logs      # 查看日志
lazybot restart   # 重启
```

数据保存在 `/opt/discordlazybot/data`（SQLite 数据库与加密密钥）。

## 本地开发

```bash
pip install -r requirements.txt
ADMIN_PASSWORD=yourpassword python -m app.main   # http://127.0.0.1:38761
```
