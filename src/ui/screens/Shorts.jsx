import { useEffect, useState } from 'react'

import { BoardExport } from '../BoardExport.jsx'
import { Classroom } from '../Classroom.jsx'
import { Empty, ErrorLine, Spinner } from '../components.jsx'
import { useApp, useLoad, useOnce } from '../hooks.js'
import { useVideoExport } from '../useVideoExport.js'
import { newId } from '../../core/ids.js'

export function ShortsScreen({ draftTopic, draftUrl, token }) {
  const { api, t } = useApp()
  const list = useLoad(() => api.call('items/list', { kind: 'shorts' }), [])
  const [topic, setTopic] = useState(draftTopic ?? '')
  const [url, setUrl] = useState(draftUrl ?? '')
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState(null)
  const video = useVideoExport()
  const autostart = useOnce(token)

  async function make() {
    if (!topic.trim() && !url.trim()) return
    setError(null)
    const id = newId('sht')
    try {
      const { job } = await api.call('short/make', { topic, url, newId: id })
      setCurrent({ id, title: topic || url, steps: [], stream: job, key: `${id}:new` })
    } catch (failure) {
      setError(failure)
    }
  }

  useEffect(() => {
    if (autostart && (draftTopic || draftUrl)) make()
  }, [])

  async function open(id) {
    try {
      const { item } = await api.call('items/get', { kind: 'shorts', id })
      setCurrent({ id: item.id, title: item.title, steps: item.board.steps, stream: null, language: item.language, key: `${item.id}:open` })
    } catch (failure) {
      setError(failure)
    }
  }

  return <div className="aha-page" data-wide="true">
    <div className="aha-split">
      <div className="aha-col" style={{ minHeight: 0 }}>
        <div className="aha-col" style={{ gap: 4 }}><h2 className="aha-title">{t('shortsTitle')}</h2><p className="aha-hint">{t('shortsHint')}</p></div>
        <div className="aha-row">
          <input className="aha-input" style={{ flex: 2, minWidth: 220 }} value={topic} placeholder={t('topicPlaceholder')} onChange={event => setTopic(event.currentTarget.value)} />
          <input className="aha-input" style={{ flex: 1, minWidth: 180 }} value={url} placeholder={t('urlPlaceholder')} onChange={event => setUrl(event.currentTarget.value)} />
          <button type="button" className="aha-btn" data-kind="primary" disabled={!topic.trim() && !url.trim()} onClick={make}>{t('makeShort')}</button>
        </div>
        <ErrorLine error={error} />
        {current ? <div className="aha-shortStage">
          <Classroom key={current.key} scope={{ kind: 'short', id: current.id }} title={current.title} steps={current.steps} stream={current.stream} language={current.language} recordChecks={false}
            onStreamDone={result => { setCurrent(previous => ({ ...previous, steps: result?.item?.board?.steps ?? previous.steps, title: result?.item?.title ?? previous.title, stream: null })); list.reload() }}
            header={({ steps }) => <>
              <BoardExport steps={steps} title={current.title} kind={null} />
              {video.exporting ? <><Spinner label={t('exporting', { percent: video.exporting.percent })} /><button type="button" className="aha-btn" data-size="sm" onClick={video.cancel}>{t('cancel')}</button></>
                : <button type="button" className="aha-btn" data-size="sm" disabled={!current.steps.length} onClick={() => video.start({ steps: current.steps, title: current.title })}>{t('exportVideo')}</button>}
            </>} />
        </div> : null}
        {current && !video.cloud ? <p className="aha-hint">{t('exportNeedsCloud')}</p> : null}
      </div>
      <aside className="aha-col" style={{ minHeight: 0, overflow: 'auto' }}>
        <h3 className="aha-cardTitle">{t('history')}</h3>
        {list.loading && !list.value ? <Spinner /> : (list.value ?? []).length ? list.value.map(item => <div key={item.id} className="aha-option" style={{ cursor: 'pointer' }} onClick={() => open(item.id)}>
          <b>{item.title}</b>
          <div className="aha-spread"><small>{new Date(item.createdAt).toLocaleString()}</small><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={async event => { event.stopPropagation(); await api.call('items/remove', { kind: 'shorts', id: item.id }); list.reload() }}>{t('delete')}</button></div>
        </div>) : <Empty>{t('empty')}</Empty>}
      </aside>
    </div>
  </div>
}
