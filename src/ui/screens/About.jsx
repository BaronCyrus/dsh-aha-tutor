// About the author: who makes Aha Tutor, where to send feedback, and the
// optional tip codes. The codes are bundled as data URLs, so the page works
// offline and needs no host route.
import alipay from '../assets/sponsor-alipay.png'
import wechat from '../assets/sponsor-wechat.png'
import qqGroup from '../assets/qq-group.png'
import { useApp } from '../hooks.js'
import { Icon } from '../icons.jsx'

export const AUTHOR = 'BaronCyrus'
export const REPOSITORY = 'https://github.com/BaronCyrus/dsh-aha-tutor'
export const QQ_GROUP = 'https://qm.qq.com/q/WAlhIlHswo'

export function AboutScreen() {
  const { t } = useApp()
  return <div className="aha-page" style={{ maxWidth: 820 }}>
    <h2 className="aha-title">{t('aboutTitle')}</h2>
    <section className="aha-card">
      <div className="aha-aboutHead">
        <span className="aha-aboutLogo"><Icon name="logo" size={28} /></span>
        <div>
          <div className="aha-cardTitle">{AUTHOR}</div>
          <div className="aha-hint">{t('aboutRole')}</div>
        </div>
      </div>
      <p className="aha-aboutIntro">{t('aboutIntro')}</p>
      <div className="aha-row">
        <a className="aha-btn" href={REPOSITORY} target="_blank" rel="noopener noreferrer">{t('aboutRepo')}</a>
        <a className="aha-btn" href={`${REPOSITORY}/issues`} target="_blank" rel="noopener noreferrer">{t('aboutIssues')}</a>
      </div>
    </section>
    <section className="aha-card">
      <div className="aha-cardTitle">{t('aboutCommunity')}</div>
      <div className="aha-community">
        <div className="aha-communityText">
          <p className="aha-aboutIntro">{t('aboutCommunityIntro')}</p>
          <div className="aha-row">
            <a className="aha-btn" href={QQ_GROUP} target="_blank" rel="noopener noreferrer">{t('aboutQqJoin')}</a>
          </div>
          <p className="aha-hint">{t('aboutCommunityScan')}</p>
        </div>
        <figure className="aha-qqGroup">
          <img src={qqGroup} width="240" height="299" alt={t('aboutQqGroupAlt')} />
          <figcaption>{t('aboutQqGroup')}</figcaption>
        </figure>
      </div>
    </section>
    <section className="aha-card">
      <div className="aha-cardTitle">{t('aboutSupport')}</div>
      <div className="aha-sponsors">
        <figure><img src={wechat} width="180" height="180" alt={t('aboutWechat')} /><figcaption>{t('aboutWechat')}</figcaption></figure>
        <figure><img src={alipay} width="180" height="180" alt={t('aboutAlipay')} /><figcaption>{t('aboutAlipay')}</figcaption></figure>
      </div>
      <p className="aha-hint" style={{ textAlign: 'center' }}>{t('aboutScan')}</p>
    </section>
  </div>
}
