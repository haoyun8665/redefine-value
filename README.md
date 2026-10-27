# 重新定义价值 · Redefine Value

<img src="assets/AppIcon.png" width="80" alt="重新定义价值紫黑科技风 App 图标">

一个常驻 macOS 桌面的紫黑色工作台：整月飞书日历、待办、项目、商务、开发、每日复盘、加密财务和备忘。

[![CI](https://github.com/haoyun8665/redefine-value/actions/workflows/ci.yml/badge.svg)](https://github.com/haoyun8665/redefine-value/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

默认打开 **一览 · 长列表**。把每天写下的内容积累起来，让重要的事一直看得见。

<img src="docs/images/overview.jpg" width="340" alt="一览按日期时间统一排列，所有记录均为演示数据">

当前版本 **0.10.9**：[下载 Mac 安装包（DMG）](https://github.com/haoyun8665/redefine-value/releases/download/v0.10.9/redefine-value-0.10.9-macos-universal.dmg) · [ZIP 压缩包](https://github.com/haoyun8665/redefine-value/releases/download/v0.10.9/redefine-value-0.10.9-macos-universal.zip)，支持 Apple Silicon 和 Intel。升级可替换应用，原有本机记录继续保留。

## 能做什么

- 紫黑科技风 App 图标；启动默认位于屏幕右上角，支持拖动、锁定位置、普通浮窗和始终置顶。
- 整月日历，可前后翻月、点选日期，自动同步飞书新增、修改、取消和删除的日程。
- **一览 / 待办 / 项目 / 商务 / 开发 / 复盘 / 财务 / 备忘** 八个分页。
- 一览把待办、项目、商务、开发、复盘和备忘按日期统一混排：今天 → 明天 → 后续日期，同日按填写时间排序，保留类型小标签和长短列表切换。
- 飞书日程从今天开始由近到远排列，支持独立上下滚动；时间管理收起后，日程延伸到面板底部。
- 月历上的飞书安排统一蓝色，本机添加的安排统一红色；自动同步当前月和下个月。
- 过往未完成工作继续显示在今天；一览末尾可展开过往记录，其他分页仍按日期累计保存。切换月历不改变工作列表。
- 待办可填写时间，名称右侧小字显示时间；项目和商务右侧显示备注。单击名称、时间或备注即可编辑，其他记录支持双击编辑。
- 待办从今天开始按日期、时间顺序排列；过往未完成事项继续显示在今天，过往已完成记录可在末尾展开查看。
- 备忘和复盘支持回车换行和自动保存，复盘输入框可自由拉高。
- 每日复盘按日保存，并生成独立 Markdown 归档；可搜索、补写历史。
- 财务需密码解锁，支持待接洽、待交付、待结算、总营收四项汇总。
- JSON 导出和可恢复的归档；财务锁定时导出不包含账目。

## 本机运行

需要 macOS 13+、Xcode Command Line Tools。运行应用本身不依赖 Node.js；开发测试需要 Node.js 18+。

```sh
git clone https://github.com/haoyun8665/redefine-value.git
cd redefine-value
chmod +x build.sh scripts/test.sh
xcode-select --install   # 已安装 Command Line Tools 时可跳过
./build.sh
```

构建结果：`dist/重新定义价值.app`，在 Finder 中打开即可。默认按本机架构构建，也可以同时构建 Apple Silicon 和 Intel：

```sh
RV_ARCHS="arm64 x86_64" ./build.sh
```

构建使用本机临时签名，尚未经过 Apple 开发者签名和公证。macOS 可能要求你在“系统设置 → 隐私与安全性”确认打开自行构建的应用；不需要关闭系统保护。

GitHub Actions 会执行检查并生成 Universal 构建压缩包，可在成功运行的 Artifacts 中下载。正式下载版本如有发布，会放在 [Releases](https://github.com/haoyun8665/redefine-value/releases)。

## 连接飞书日历

自行安装并配置[飞书官方 CLI](https://github.com/larksuite/cli/blob/main/README.zh.md)：

```sh
npx @larksuite/cli@latest install
lark-cli config init
```

然后在本应用“设置 → 连接飞书 CLI”中授权。应用仅申请 `calendar:calendar:readonly offline_access`，使用本人身份读取日历，每分钟刷新，也支持手动同步。也可使用自建应用 API 模式，配置方式见[使用说明](docs/USAGE.md)。

本机工作记录不会写回飞书。睡眠或退出期间不会同步；当前支持可读取的飞书主日历及共享日历，不承诺复刻飞书全部客户端功能。

## 数据放在哪里

默认保存在本机 `~/Library/Application Support/在场/`。这个旧目录名和应用标识保持兼容，便于升级已有版本。

| 文件 | 内容 |
| --- | --- |
| `state.json` | 本机工作记录、备忘、复盘和设置，不含明文财务 |
| `finance-vault.json` | AES-256-GCM 加密的财务保险箱 |
| `calendar-cache.json` | 飞书日程缓存 |
| `reflections/` | 按日期归档的 Markdown 复盘 |

财务密码使用 PBKDF2-HMAC-SHA256 派生密钥。切换分页、收起、锁屏、休眠或闲置后重新锁定。普通工作记录和日程缓存仍是本机明文文件；历史截图和用户主动导出的 JSON 不会自动加密。财务密码遗忘后没有恢复后门。

仓库不包含个人日程、账目、密码、Token、私钥或本机应用数据。文档截图只使用演示数据。详见[安全说明](SECURITY.md)。

## 开发与验证

```sh
./scripts/test.sh              # macOS：JavaScript + 三组原生测试
./scripts/test.sh --web-only   # macOS / Linux：仅 JavaScript
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

浏览器预览仅供界面开发；财务解锁、桌面层级、钥匙串、飞书授权和通知需要 Mac 应用。

| 路径 | 用途 |
| --- | --- |
| `Native.swift` | AppKit / WKWebView 外壳、授权、窗口及系统功能 |
| `Integration.swift` | 官方 CLI 适配、复盘归档 |
| `FinanceVault.swift` | 财务加密存储与会话锁定 |
| `web/` | 无前端框架的 HTML / CSS / JavaScript |
| `tests/` | 日期规则、编辑、保存、加密及模拟飞书测试 |

欢迎提交 Issue 和 Pull Request。请先阅读[贡献说明](CONTRIBUTING.md)。

## 许可证

[MIT License](LICENSE)，Copyright (c) 2026 haoyun8665。

这是独立开源项目，与飞书 / Lark 和 Apple 无隶属关系。
