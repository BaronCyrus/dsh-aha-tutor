import { useEffect, useMemo, useState } from 'react'

import { ErrorLine, Spinner } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'
import { browserSpeechAvailable, listVoices, onVoicesChanged, pickVoice } from '../speech.js'
import { BOARD_FONT } from '../styles.js'

const PROVIDERS = [['openai', 'providerOpenai'], ['volcengine', 'providerVolcengine'], ['minimax', 'providerMinimax'], ['azure', 'providerAzure']]

export function SettingsScreen() {
  const { api, t, settings, reloadSettings, setVoiceId, speech, language } = useApp()
  const models = useLoad(() => api.call('models/list'), [])
  const [error, setError] = useState(null)
  const [voices, setVoices] = useState(() => listVoices())
  const [keyDraft, setKeyDraft] = useState('')
  const [testing, setTesting] = useState(false)
  useEffect(() => onVoicesChanged(setVoices), [])

  async function save(patch) {
    setError(null)
    try {
      await api.call('settings/save', { settings: patch })
      await reloadSettings()
    } catch (failure) {
      setError(failure)
    }
  }

  const routeValue = (provider, model) => (provider && model ? `${provider}::${model}` : '')
  const setRoute = (prefix, value) => {
    const [provider = '', model = ''] = value ? value.split('::') : []
    save({ [`${prefix}Provider`]: provider, [`${prefix}Model`]: model })
  }
  const modelOptions = useMemo(() => (models.value ?? []).map(row => ({ value: `${row.provider}::${row.model}`, label: `${row.providerName} · ${row.name}${row.images ? ' 🖼' : ''}` })), [models.value])

  const lang = language === 'zh' ? 'zh-CN' : 'en'
  const matchingVoices = voices.filter(voice => voice.lang.toLowerCase().startsWith(lang.split('-')[0]))
  const provider = settings.ttsProvider ?? 'openai'
  const fields = (settings.fields?.[provider] ?? []).filter(field => !field.secret)
  const providerConfig = settings.tts?.[provider] ?? {}

  async function test() {
    setTesting(true)
    try {
      speech.configure({ engine: settings.voiceEngine ?? 'browser', voiceId: settings.voiceId || undefined, language: lang, rate: settings.voiceRate ?? 1 })
      const spoken = speech.speak(t('testSentence'), { rate: settings.voiceRate ?? 1 })
      const result = await spoken.done
      if (result?.error) setError(new Error(result.error))
    } finally {
      setTesting(false)
    }
  }

  if (!settings.voiceEngine) return <div className="aha-page"><Spinner label={t('loading')} /></div>
  return <div className="aha-page" style={{ maxWidth: 820 }}>
    <h2 className="aha-title">{t('settingsTitle')}</h2>
    <ErrorLine error={error} />

    <section className="aha-card">
      <b>{t('modelsTitle')}</b>
      <p className="aha-hint">{t('modelsHint')}</p>
      {[['teach', 'teachModel'], ['quick', 'quickModel']].map(([prefix, label]) => <label key={prefix} className="aha-label">{t(label)}
        <select className="aha-select" value={routeValue(settings[`${prefix}Provider`], settings[`${prefix}Model`])} onChange={event => setRoute(prefix, event.currentTarget.value)}>
          <option value="">{t('followDefault')}</option>
          {modelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>)}
      {models.loading ? <Spinner /> : null}
    </section>

    <section className="aha-card">
      <b>{t('voiceTitle')}</b>
      <div className="aha-row" style={{ gap: 6 }}>
        {[['browser', 'engineBrowser'], ['cloud', 'engineCloud'], ['off', 'engineOff']].map(([value, label]) => <button key={value} type="button" className="aha-chip" data-active={settings.voiceEngine === value} onClick={() => save({ voiceEngine: value })}>{t(label)}</button>)}
      </div>
      <label className="aha-label">{t('voiceRate')} · {settings.voiceRate ?? 1}×
        <input type="range" min="0.5" max="2" step="0.05" value={settings.voiceRate ?? 1} onChange={event => save({ voiceRate: Number(event.currentTarget.value) })} />
      </label>
      {settings.voiceEngine === 'browser' ? <>
        <label className="aha-label">{t('browserVoice')}
          <select className="aha-select" value={settings.voiceId ?? ''} onChange={event => setVoiceId(event.currentTarget.value)}>
            <option value="">{t('autoVoice')}{pickVoice(lang) ? ` (${pickVoice(lang).name})` : ''}</option>
            {(matchingVoices.length ? matchingVoices : voices).map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.lang}{voice.local ? '' : ' ☁'}</option>)}
          </select>
        </label>
        {browserSpeechAvailable() && !matchingVoices.length ? <p className="aha-hint">{t('noVoiceForLanguage')}</p> : null}
      </> : null}
      {settings.voiceEngine === 'cloud' ? <div className="aha-col">
        <label className="aha-label">{t('cloudProvider')}
          <select className="aha-select" value={provider} onChange={event => save({ ttsProvider: event.currentTarget.value })}>
            {PROVIDERS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select>
        </label>
        {fields.map(field => <label key={field.key} className="aha-label">{t(`field_${field.key}`)}
          <input className="aha-input" defaultValue={providerConfig[field.key] ?? ''} key={`${provider}:${field.key}:${providerConfig[field.key] ?? ''}`} onBlur={event => {
            const value = event.currentTarget.value.trim()
            if (value !== (providerConfig[field.key] ?? '')) save({ tts: { [provider]: { [field.key]: value } } })
          }} />
        </label>)}
        <label className="aha-label">{t('field_apiKey')} · <span className={settings.keys?.[provider] ? 'aha-ok' : 'aha-hint'}>{settings.keys?.[provider] ? t('keySaved') : t('keyMissing')}</span>
          <div className="aha-row">
            <input className="aha-input" style={{ flex: 1 }} type="password" autoComplete="off" spellCheck={false} value={keyDraft} onChange={event => setKeyDraft(event.currentTarget.value)} />
            <button type="button" className="aha-btn" disabled={!keyDraft.trim()} onClick={async () => {
              setError(null)
              try {
                await api.call('settings/set-key', { provider, key: keyDraft.trim() })
                setKeyDraft('')
                await reloadSettings()
              } catch (failure) {
                setError(failure)
              }
            }}>{t('saveKey')}</button>
            {settings.keys?.[provider] ? <button type="button" className="aha-btn" data-kind="ghost" onClick={async () => { await api.call('settings/clear-key', { provider }); await reloadSettings() }}>{t('clearKey')}</button> : null}
          </div>
        </label>
      </div> : null}
      <div><button type="button" className="aha-btn" disabled={testing || settings.voiceEngine === 'off'} onClick={test}>{testing ? <span className="aha-spinner" /> : '🔊'} {t('testVoice')}</button></div>
    </section>

    <section className="aha-card">
      <b>{t('boardTheme')}</b>
      <div className="aha-row" style={{ gap: 6 }}>{[['auto', 'themeAuto'], ['light', 'themeLight'], ['dark', 'themeDark']].map(([value, label]) => <button key={value} type="button" className="aha-chip" data-active={(settings.boardTheme ?? 'auto') === value} onClick={() => save({ boardTheme: value })}>{t(label)}</button>)}</div>
      <b>{t('boardFont')}</b>
      <div className="aha-row" style={{ gap: 6 }}>{[['hand', 'fontHand'], ['standard', 'fontStandard']].map(([value, label]) => <button key={value} type="button" className="aha-chip" data-active={(settings.boardFont ?? 'hand') === value} onClick={() => save({ boardFont: value })} style={value === 'hand' ? { fontFamily: BOARD_FONT } : undefined}>{t(label)}</button>)}</div>
    </section>

    <VersionCard />
    <p className="aha-hint">{t('privacyNote')}</p>
  </div>
}

function VersionCard() {
  const { api, t } = useApp()
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [result, setResult] = useState(null)
  const [updateFailed, setUpdateFailed] = useState(false)

  const load = force => {
    setLoading(true)
    setFailed(false)
    api.call('plugin/version', { force }).then(setInfo).catch(() => setFailed(true)).finally(() => setLoading(false))
  }
  useEffect(() => { load(false) }, [])

  async function update() {
    setUpdating(true)
    setUpdateFailed(false)
    try {
      setResult(await api.call('plugin/update'))
    } catch {
      setUpdateFailed(true)
    } finally {
      setUpdating(false)
    }
  }

  const kind = info?.install?.kind
  return <section className="aha-card">
    <div className="aha-spread"><b>{t('versionTitle')}</b><button type="button" className="aha-btn" data-size="sm" disabled={loading || updating} onClick={() => load(true)}>{loading ? t('versionChecking') : t('versionCheck')}</button></div>
    {failed ? <p className="aha-error">{t('versionFailed')}</p> : null}
    {info ? <>
      <div className="aha-spread"><span>{t('versionCurrent')}</span><span className="aha-hint">v{info.current}</span></div>
      <div className="aha-spread"><span>{t('versionLatest')}</span><span className="aha-hint">{info.latest ? `v${info.latest}` : '—'}</span></div>
      {!result ? <p className={info.latestUnknown ? 'aha-error' : 'aha-hint'}>{info.latestUnknown ? t('versionFailed') : info.updateAvailable ? t('versionAvailable', { version: info.latest }) : t('versionUpToDate')}</p> : null}
      {!result && info.updateAvailable && kind === 'npm' ? <div><button type="button" className="aha-btn" data-kind="primary" disabled={updating} onClick={update}>{updating ? t('versionUpdating') : t('versionUpdate')}</button></div> : null}
      {kind === 'link' ? <p className="aha-hint">{t('versionLinked')}</p> : null}
      {info.updateAvailable && kind === 'unknown' ? <p className="aha-hint">{t('versionManual', { version: info.latest })}</p> : null}
    </> : null}
    {updateFailed ? <p className="aha-error">{t('versionUpdateFailed')}</p> : null}
    {result?.pending ? <p className="aha-hint">{typeof result.availableAt === 'number' ? t('versionPendingUntil', { version: result.version, time: new Date(result.availableAt).toLocaleString() }) : t('versionPending', { version: result.version })}</p> : null}
    {result && !result.pending ? <div className="aha-feedback" data-ok="true">{t('versionUpdated', { version: result.version })}</div> : null}
  </section>
}
