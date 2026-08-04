import { useState } from 'react'
import { LoadingOutlined } from '@ant-design/icons'
import { App as AntApp, Button, Card, Input, Typography } from 'antd'
import {
  getJarvisAuthLoginUrl,
  JARVIS_TOKEN_KEY,
  JARVIS_USERNAME_KEY,
} from '../auth'
import { createTimedRequest } from '../api/request'

interface LoginPageProps {
  onSuccess: (token: string, username: string) => void
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const { message } = AntApp.useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')

  const handleSubmit = async () => {
    const trimmedUsername = username.trim()
    if (!trimmedUsername || !password) {
      setErrorText('请输入用户名和密码')
      return
    }

    setLoading(true)
    setErrorText('')
    const timedRequest = createTimedRequest()
    try {
      const response = await fetch(getJarvisAuthLoginUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmedUsername, password }),
        signal: timedRequest.signal,
      })

      if (response.status === 401) {
        setErrorText('用户名或密码错误')
        return
      }
      if (!response.ok) {
        setErrorText('网络异常，请稍后重试')
        return
      }

      const payload = await response.json() as {
        ok?: boolean
        token?: string
        username?: string
      }
      if (!payload.ok || !payload.token) {
        setErrorText('登录失败，请稍后重试')
        return
      }

      const resolvedUsername = payload.username ?? trimmedUsername
      localStorage.setItem(JARVIS_TOKEN_KEY, payload.token)
      localStorage.setItem(JARVIS_USERNAME_KEY, resolvedUsername)
      onSuccess(payload.token, resolvedUsername)
    } catch {
      setErrorText('网络异常，请稍后重试')
      void message.error('网络异常，请稍后重试')
    } finally {
      timedRequest.dispose()
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <Card className="login-card" variant="borderless">
        <div className="login-brand">
          <span className="brand-mark" />
          <div>
            <Typography.Title level={2}>ROBIN</Typography.Title>
            <Typography.Text>个人 AI 助手 · 语音 / 文字</Typography.Text>
          </div>
        </div>
        <Typography.Paragraph type="secondary" className="login-hint">
          登录后开启语音实时对话、文字思考与跨设备记忆
        </Typography.Paragraph>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <label className="login-label" htmlFor="jarvis-login-username">用户名</label>
          <Input
            id="jarvis-login-username"
            size="large"
            placeholder="请输入用户名"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={loading}
            autoComplete="username"
          />
          <label className="login-label" htmlFor="jarvis-login-password">密码</label>
          <Input.Password
            id="jarvis-login-password"
            size="large"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            autoComplete="current-password"
          />
          {errorText && <div className="login-error" role="alert">{errorText}</div>}
          <Button
            type="primary"
            size="large"
            block
            htmlType="submit"
            loading={loading}
            icon={loading ? <LoadingOutlined /> : undefined}
          >
            登录
          </Button>
        </form>
      </Card>
    </main>
  )
}
