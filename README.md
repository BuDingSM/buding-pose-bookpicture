# 搭像 · 工作台源码

搭像（https://pose.xizanghuapi.cn）的前端工作台：多分类参考图搭配（姿势 / 人物 / 服装 / 场景 / 家具 / 道具 / 光线 / 动物），合成提示词后调用生图模型生成一张图。

## 两个仓库

| 内容 | 仓库 | 分支 |
| --- | --- | --- |
| 代码（本仓库） | BuDingSM/buding-pose-bookpicture | main |
| 数据（目录、图片、数据库） | BuDingSM/pose-book | main |

数据仓库的 main 也是服务器 staging（`/root/pose-data`）的来源；本仓库 `public/catalog/` 里的目录 JSON 只是数据仓库的一份拷贝，以数据仓库为准。

## 目录

- `src/App.tsx` 界面：图库、工作台、搭配历史、/admin、/stats
- `src/generate.ts` 生图调用（站内引擎 / 自带 Key）
- `src/types.ts` 分类、图片地址、API 设置
- `src/i18n.ts` 中文 / 繁体 / 英文 / 日文
- `public/catalog/` 目录 JSON（见上）
- `index.html`、`package.json`、`vite.config.ts`

## 本地开发

```bash
npm install
npm run dev     # 本地调试
npm run build   # 构建 dist
```

## 线上

- 站点 https://pose.xizanghuapi.cn，服务器目录 `/www/wwwroot/pose-book-studio`
- 生图后端 `/www/wwwroot/pose-book-api`（127.0.0.1:3029），经 nginx `/api/` 代理
- 部署：打包 dist → tar 传服务器 → 硬链接备份后替换 → 从 staging 同步 catalog

## 生图

- 用户自己的 Key：只存在浏览器，不上服务器
- 站内引擎：积分卡，卡密只存 SHA-256，见 /admin
