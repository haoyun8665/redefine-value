# 重新定义价值 · Redefine Value

<img src="assets/AppIcon.png" width="80" alt="重新定义价值紫黑科技风 App 图标">

一个常驻 macOS 桌面的紫黑色工作台：整月飞书日历、待办、项目、商务、开发、每日复盘、加密财务和备忘。

[![CI](https://github.com/haoyun8665/redefine-value/actions/workflows/ci.yml/badge.svg)](https://github.com/haoyun8665/redefine-value/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

默认打开 **一览 · 长列表**。把每天写下的内容积累起来，让重要的事一直看得见。

<img src="docs/images/overview.jpg" width="340" alt="一览按日期时间统一排列，所有记录均为演示数据">

当前源码版本 **0.10.25**，包含所选日期日程明细及下述全部功能，可按下方步骤构建。最近发布的安装包仍为 **0.10.9**：[Mac 安装包（DMG）](https://github.com/haoyun8665/redefine-value/releases/download/v0.10.9/redefine-value-0.10.9-macos-universal.dmg) · [ZIP 压缩包](https://github.com/haoyun8665/redefine-value/releases/download/v0.10.9/redefine-value-0.10.9-macos-universal.zip)，支持 Apple Silicon 和 Intel。升级可替换应用，原有本机记录继续保留。

## 能做什么

- 紫黑科技风 App 图标；打开、最小化或关闭窗口后均保留 Dock 图标，点击可恢复，退出应用后消失。启动默认位于屏幕右上角，支持拖动、锁定位置、普通浮窗和始终置顶。
- 整月日历，可前后翻月、点选日期，自动同步飞书新增、修改、取消和删除的日程。
- **一览 / 待办 / 项目 / 商务 / 开发 / 复盘 / 财务 / 备忘** 八个分页。
- 一览把待办、项目、商务、开发、复盘和备忘按日期统一混排：今天 → 明天 → 后续日期，同日按填写时间排序，保留类型小标签和长短列表切换。
- 点击月历日期，自动展开“日程明细”：当天飞书日程、本机待办、商务和开发安排按时间混排，飞书蓝色、本机红色；支持独立上下滚动，时间管理收起后延伸到面板底部。
- 月历直接显示时间与事项，飞书安排统一蓝色，本机添加的安排统一红色；全天和跨天单独标记，自动同步当前月和下个月。
- 过往未完成工作继续显示在今天；待办、项目、商务、开发和一览都将已完成事项统一放在末尾，取消勾选可恢复。一览的历史复盘和备忘仍可展开查看。切换月历不改变工作列表。
- 待办可填写时间，名称右侧小字显示时间；项目和商务右侧显示备注。单击名称、时间或备注即可编辑，其他记录支持双击编辑。
- 待办从今天开始按日期、时间顺序排列；过往未完成事项继续显示在今天，过往已完成记录可在末尾展开查看。
- 备忘和复盘支持回车换行和自动保存，复盘输入框可自由拉高。
- 每日复盘每次“新增”打开空白记录，同一天可写多条，分别保存草稿、提交和修改；旧复盘继续保留，全部记录可搜索、补写、导出并生成独立 Markdown 归档。
- 财务需密码解锁，点击待接洽、待交付、待结算查看阶段明细；预估营收合计所有收入阶段，实际营收只计已结算，两项均可点击查看明细，“全部”查看收支；每条活动收入可点击右侧按钮推进下一阶段。财务不使用勾选框，已结算记录统一置底，可在编辑窗口调整阶段。账目可删除并从“最近删除”恢复，删除后不计入汇总。
- 一键“导出全部”为 ZIP，包含全部模块、归档、历史复盘、设置和已同步的飞书日程，内含可阅读文档与 JSON；财务锁定时先验证密码。

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
./scripts/test.sh              # macOS：JavaScript + 四组原生测试
./scripts/test.sh --web-only   # macOS / Linux：仅 JavaScript
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

浏览器预览仅供界面开发；财务解锁、桌面层级、钥匙串、飞书授权和通知需要 Mac 应用。

| 路径 | 用途 |
| --- | --- |
| `Native.swift` | AppKit / WKWebView 外壳、授权、窗口及系统功能 |
| `Integration.swift` | 官方 CLI 适配、复盘归档 |
| `FinanceVault.swift` | 财务加密存储与会话锁定 |
| `Export.swift` | 完整数据与可阅读文档的 ZIP 导出 |
| `web/` | 无前端框架的 HTML / CSS / JavaScript |
| `tests/` | 日期规则、编辑、保存、加密及模拟飞书测试 |

欢迎提交 Issue 和 Pull Request。请先阅读[贡献说明](CONTRIBUTING.md)。

## 许可证

[MIT License](LICENSE)，Copyright (c) 2026 haoyun8665。

这是独立开源项目，与飞书 / Lark 和 Apple 无隶属关系。
