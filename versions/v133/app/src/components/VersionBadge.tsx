import { APP_VERSION } from '../version'

/** 角落版本角标：确认热更新是否拉到新包 */
export default function VersionBadge() {
  return (
    <div className="app-version-badge" aria-hidden title={`Robin ${APP_VERSION}`}>
      {APP_VERSION}
    </div>
  )
}
