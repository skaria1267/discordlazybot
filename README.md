# LazyBot

部署在 VPS 上的 Discord 角色扮演 bot，所有配置通过手机网页后台完成，保存即生效。

- 人设、上下文、主动插话、模型可按 全局 / 服务器 / 频道 分层配置，每层可选继承
- 服务器总记忆 + 群友个人记忆，选区间总结、确认后写入，带版本历史和回滚，各服务器互不串
- 上下文中群友以 `[服务器昵称-用户名-用户ID]` 标识，记录曾用名，带时间戳
- 被 @ / 被回复时回答；可配置概率、冷却、次数上限的主动插话（小模型先判断）
- 自动给所有服务器的表情打标签，按使用频率挑选候选表情点反应
- 支持 OpenAI 兼容格式与 Claude 格式，按用途分配模型，主模型失败自动切换备用
- 模型列表可拉取并保存，支持下拉选填或直接输入列表以外的模型名
- 聊天支持工具调用、搜索服务联网，以及 Claude 原生联网搜索；可按全局 / 服务器 / 频道选择纯聊天或联网
- 私聊白名单、三种私聊模式（`!mode` 指令切换）
- 用量统计、实时日志、报错记录

## 部署

VPS 需要已安装 Docker 和 Docker Compose；以 root 运行脚本，并将后台域名通过 Cloudflare 代理到 VPS。

```bash
curl -fsSL https://raw.githubusercontent.com/skaria1267/discordlazybot/main/deploy/install.sh -o install.sh && bash install.sh
```

脚本会询问域名和后台密码，自动生成自签名证书、配置 Nginx 并启动容器；已有证书时保留。使用生成的自签名证书时，Cloudflare SSL/TLS 加密模式请选择「完全」；「完全（严格）」需要自行配置有效的源站证书。

首次登录后，在「设置 → 机器人连接」填写 Discord bot token，在 Discord Developer Portal 的 Bot 页面启用 **Server Members Intent** 和 **Message Content Intent**，再从后台邀请机器人进服务器。

常用命令：

```bash
lazybot update    # 拉取最新镜像并重启
lazybot logs      # 查看日志
lazybot restart   # 重启
lazybot stop      # 停止
```

数据保存在 `/opt/discordlazybot/data`（SQLite 数据库与加密密钥）。

## 接口与模型

在「设置 → 接口与模型」添加供应商、填写 API 地址和 Key，再保存。OpenAI 兼容格式使用 `/v1/chat/completions`，Claude 格式使用 `/v1/messages`；填根地址或 `/v1` 时会自动补齐路径。

点击「获取模型列表」或模型输入框旁的「拉取」，即可在下拉框选择模型。已保存供应商的列表会存入数据库，刷新页面或重新打开后台仍可选择；修改供应商地址或格式后需要重新拉取。文本框始终允许自填模型名，模型不在列表中、供应商不提供列表或拉取失败时也能保存。Claude 模型列表支持分页。

聊天、插话判断、记忆总结、表情打标和备用模型仍分别配置。服务器和频道可覆盖聊天模型；同时填写供应商和模型名才会覆盖默认聊天模型。

## 工具调用与联网搜索

在「设置 → 默认人设」或服务器 / 频道的「聊天模型与联网」中设置联网方式，默认是 **纯聊天**：

| 模式 | 支持的接口 | 行为 |
| --- | --- | --- |
| 纯聊天 | OpenAI 兼容、Claude | 普通聊天请求，不发送工具定义、不调用搜索 |
| 工具调用 + 搜索服务 | 支持工具调用的 OpenAI 兼容、Claude | 模型按需调用 `web_search`，机器人执行搜索并回传结果 |
| Claude 原生联网搜索 | 支持原生搜索的 Claude 格式接口 | 使用 `web_search_20250305`，搜索由模型供应商执行 |

这些设置继承全局 → 服务器 → 频道；私聊使用所选服务器或全局的聊天设置。工具仅用于聊天回复（包括主动插话的最终回复），不会加到插话判断、记忆总结或表情打标请求里。

### 搜索服务配置

在「设置 → 联网搜索」选择搜索服务，保存后可用「测试已保存的配置」检查：

- **Tavily**：默认地址 `https://api.tavily.com`，填写 Tavily API Key。支持自定义服务根地址或完整 `/search` 地址。
- **SearXNG**：填写你的服务根地址或 `/search` 地址。服务需要在 `settings.yml` 的 `search.formats` 中启用 `json`；不发送 Tavily Key。

Key 加密保存在数据库中，后台只返回遮罩；留空保留原 Key，勾选清除后删除。搜索返回 1–10 条结果及来源 URL；模型按需要搜索，不会每条消息都搜索。

Claude 原生搜索不使用这里的搜索服务或 Key。模型和反代必须支持原生搜索；选择 Claude 原生模式时，备用模型也需要使用支持该功能的 Claude 格式接口。供应商不支持时可以改用搜索服务模式，项目不会偷偷改成纯聊天。

工具调用支持 OpenAI 的 `tool_calls` / `tool` 消息，以及 Claude 的 `tool_use` / `tool_result` 内容块。当前内置客户端工具为 `web_search`；工具出错时回传错误供模型解释，未知工具不会执行。每次回复最多执行 1–8 轮客户端工具调用（默认 4 轮）、总计最多 12 次客户端搜索，达到轮数后要求模型用已有结果作答；Claude 原生搜索每次 API 请求最多 5 次搜索，`pause_turn` 续接次数同样受轮数设置限制。无法完成回复的模型请求按原有逻辑尝试备用模型。

Claude 原生搜索保留续接所需的原始内容块与加密搜索结果，并把最终引用转成 Discord 可点击的来源链接。外部搜索的来源 URL 交给模型引用。每轮模型请求都会记录 token 与缓存读写用量，即使后续失败也保留已经产生的用量；搜索服务和原生搜索本身的费用不包含在 token 账本中。

### 提示词与缓存

本次功能不改写现有 `system`，也不向已有聊天消息塞入工具说明。工具定义通过独立 `tools` 参数发送；实际调用时仅在本轮消息末尾追加调用和结果，最终回复仍使用原有文字 / 表情 / 贴纸格式。工具过程只用于本次回复，聊天数据库继续保存 Discord 消息与最终回复。

**缓存断点由反代处理**，项目不添加 `cache_control`、缓存 TTL 或其他缓存控制参数。已有 OpenAI / Claude 缓存读写统计继续支持。

同一次回复的续轮复用同一份 `system`、初始聊天消息和工具定义，Claude 原始内容块、OpenAI 工具 ID 与供应商扩展字段按原样回传。首次开启工具、更改工具定义或切换联网模式会改变模型输入前缀，可能需要重新建立缓存；追加在原断点之后的结果不改写原前缀。实际缓存命中取决于反代和供应商规则。

## 本地开发

```bash
pip install -r requirements.txt
ADMIN_PASSWORD=yourpassword python -m app.main   # http://127.0.0.1:38761
```

Windows PowerShell：

```powershell
$env:ADMIN_PASSWORD = 'yourpassword'
python -m app.main
```

未设置 `ADMIN_PASSWORD` 时，首次启动会生成随机密码并写入数据目录的 `initial_password.txt`。数据目录默认 `./data`，可通过 `DATA_DIR` 修改。备份时请一起保留 `bot.db` 和 `secret.key`；已有后台密码不会被环境变量覆盖，可在后台修改。

离线测试（使用临时数据库，不访问真实模型、搜索服务或 Discord）：

```bash
python -m unittest discover -s tests -v
```

推送 `main` 后，现有 GitHub Actions 会构建并推送 `linux/amd64`、`linux/arm64` 镜像。VPS 在新镜像构建完成后执行 `lazybot update` 更新。
