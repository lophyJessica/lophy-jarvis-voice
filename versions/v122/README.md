# v122 — 发送后立即清空输入框

## 改动文件

- `app/src/App.tsx`
- `app/src/components/ComposerStack.tsx`

## 说明

- `onSend` 改为同步返回 `boolean`：`prepareSendTurn` 校验通过后立即 `true`，`executeSendTurn` 异步执行，不再等 Robin 回复。
- Composer：`flushSync(() => setInput(''))` 在点击发送时同步清空；校验失败时同步恢复。
- 保留 `setTextIfIdle` 与 `inputValueRef`，发送后用户新输入不会被异步回调覆盖。
