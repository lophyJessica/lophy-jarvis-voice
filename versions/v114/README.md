# v114 — 修滚动条滑块被输入区遮住

## 改动文件
- `src/App.css`

## 说明
- 底部 `composer` 改为 `right: 14px`，让出滚动条列，滑块在底部不再被渐变遮住。
- 滑块改为深灰 `#5c5c5c`，去掉 `background-clip` 避免部分浏览器不绘制 thumb。
- `card-body` 加 `position: relative` 固定输入区定位基准。
