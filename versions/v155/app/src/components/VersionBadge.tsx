import { APP_VERSION } from '../version'

type VersionBadgeProps = {
  /** header：顶栏状态标签同排；fixed：登录页角落角标 */
  placement?: 'header' | 'fixed'
}

/** 版本号展示：确认热更新是否拉到新包 */
export default function VersionBadge({ placement = 'fixed' }: VersionBadgeProps) {
  return (
    <span
      className={placement === 'header' ? 'app-version-badge app-version-header' : 'app-version-badge app-version-fixed'}
      aria-hidden
      title={`Robin ${APP_VERSION}`}
    >
      {APP_VERSION}
    </span>
  )
}
