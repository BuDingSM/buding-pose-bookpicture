# 布丁姿势书

中文 AI 生图参考图库。当前接入 Shisei 姿势和服装数据，支持搜索、分类、视角和图层切换、下载、浏览器本地收藏与搭配。每个品类在搭配中最多保留一项。

## 本地运行

需要 Node.js 18+ 和一份包含 `data/catalog.json`、`images/` 的 Shisei 仓库。导入脚本只复制实际存在的图片，并生成 `catalog.json` 和 `assets/`：

```sh
node scripts/import-shisei.mjs /path/to/shisei
npx --yes http-server . -p 8080
```

打开 http://localhost:8080。图片和生成的数据不提交 Git；公开部署需另外托管生成产物。不要直接双击 HTML，浏览器可能阻止本地数据读取。

## 来源与使用

首版图片来自 [Shisei](https://github.com/wquguru/shisei)，其姿势目录参考了ギア的 ai-pose-gallery。本站整合资源仅供非商业使用；各素材的原有权利及授权条件不因本声明改变。项目尚未指定代码许可证，指定前不能假定代码已经获得开源许可。

导入脚本读取本地文件，不会从上游下载数据。部署者需要自行确认其取得的授权覆盖使用和分发方式。
