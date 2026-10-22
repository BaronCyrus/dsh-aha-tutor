import { useEffect, useState } from 'react'

import { Confirm, ErrorLine, Spinner } from '../components.jsx'
import { useApp, useLoad } from '../hooks.js'

const LIST_FIELDS = [['goals', 'goals'], ['strengths', 'strengthsLabel'], ['weaknesses', 'weaknesses']]

export function ProfileScreen() {
  const { api, t, toast } = useApp()
  const profile = useLoad(() => api.call('profile/get'), [])
  const [draft, setDraft] = useState(null)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!profile.value) return
    setDraft({
      name: profile.value.name ?? '',
      background: profile.value.background,
      goals: profile.value.goals.join('\n'),
      strengths: profile.value.strengths.join('\n'),
      weaknesses: profile.value.weaknesses.join('\n'),
      style: profile.value.preferences?.style ?? '',
    })
  }, [profile.value])

  async function save() {
    setError(null)
    try {
      const lines = value => value.split('\n').map(line => line.trim()).filter(Boolean)
      profile.setValue(await api.call('profile/save', { name: draft.name.trim(), background: draft.background, goals: lines(draft.goals), strengths: lines(draft.strengths), weaknesses: lines(draft.weaknesses), preferences: { ...profile.value.preferences, style: draft.style } }))
      toast(t('saved'))
    } catch (failure) {
      setError(failure)
    }
  }

  if (!draft) return <div className="aha-page"><Spinner label={t('loading')} /></div>
  return <div className="aha-page" style={{ maxWidth: 820 }}>
    <div className="aha-col" style={{ gap: 4 }}><h2 className="aha-title">{t('profileTitle')}</h2><p className="aha-hint">{t('profileHint')}</p></div>
    <section className="aha-card">
      <label className="aha-label">{t('profileName')} <span className="aha-hint">（{t('profileNameHint')}）</span><input className="aha-input" maxLength={20} value={draft.name} placeholder={t('profileNamePlaceholder')} onChange={event => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
      <label className="aha-label">{t('background')}<textarea className="aha-textarea" value={draft.background} onChange={event => setDraft({ ...draft, background: event.currentTarget.value })} /></label>
      {LIST_FIELDS.map(([key, label]) => <label key={key} className="aha-label">{t(label)} <span className="aha-hint">（{t('onePerLine')}）</span><textarea className="aha-textarea" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.currentTarget.value })} /></label>)}
      <label className="aha-label">{t('learningStyle')}<input className="aha-input" value={draft.style} onChange={event => setDraft({ ...draft, style: event.currentTarget.value })} /></label>
      <div className="aha-row"><button type="button" className="aha-btn" data-kind="primary" onClick={save}>{t('save')}</button><button type="button" className="aha-btn" data-kind="danger" onClick={() => setClearing(true)}>{t('clearProfile')}</button></div>
      <ErrorLine error={error} />
    </section>
    {profile.value.notes?.length ? <section className="aha-card">
      <b>{t('memoryNotes')}</b>
      {profile.value.notes.map(note => <div key={note.id} className="aha-spread"><span>{note.text}</span><button type="button" className="aha-btn" data-kind="ghost" data-size="sm" onClick={async () => profile.setValue(await api.call('profile/remove-note', { id: note.id }))}>{t('delete')}</button></div>)}
    </section> : null}
    <p className="aha-hint">{t('privacyNote')}</p>
    {clearing ? <Confirm danger text={t('clearProfileConfirm')} onCancel={() => setClearing(false)} onConfirm={async () => { profile.setValue(await api.call('profile/clear')); setClearing(false) }} /> : null}
  </div>
}
