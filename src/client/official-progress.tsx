import React, { useEffect, useState } from 'react'
import type { OfficialProgress } from '../official-types.js'

export function OfficialProgressStatus({ progress }: { progress: OfficialProgress | null }) {
  const [now, setNow] = useState(() => Date.now())
  const start = progress?.stage === 'analyzing' ? progress.analysisStartedAt : undefined
  useEffect(() => {
    if (!start || !Number.isFinite(Date.parse(start))) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [start])
  if (!progress) return null
  const elapsed = start ? Math.max(0, Math.floor((now - Date.parse(start)) / 1000)) : undefined
  return <p role="status">{{ reading: '读取网页', analyzing: '分析资料', diffing: '生成差异' }[progress.stage]}… 已读取 {progress.pageCount} 页{progress.round ? `，第 ${progress.round} 轮` : ''}
    {Number.isFinite(elapsed) && progress.analysisTimeoutSeconds ? `，本轮已用 ${elapsed} 秒 / 时限 ${progress.analysisTimeoutSeconds} 秒` : ''}</p>
}
