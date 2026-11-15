import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Toggle } from '@/ui/components/ui';
import { Icon } from '@/ui/components/Icon';
import { LogoLockup } from '@/ui/components/Logo';
import { CAMPAIGN_LEVELS, sandboxBest, totalStars } from '@/ui/lib/campaign';
import { fmtNum } from '@/ui/lib/format';

export function SettingsScreen() {
  const profile = useGame((state) => state.profile);
  const go = useGame((state) => state.go);
  const updateSettings = useGame((state) => state.updateSettings);
  const resetProgress = useGame((state) => state.resetProgress);
  const [confirming, setConfirming] = useState(false);

  const settings = profile.settings;
  const stars = totalStars(profile);
  const best = sandboxBest(profile);

  return (
    <div className="screen paper-bg">
      <div className="settings">
        <div className="settings__head">
          <button
            type="button"
            className="campaign__brand"
            onClick={() => go('title')}
            aria-label="Back to title screen"
          >
            <LogoLockup compact />
          </button>
          <span className="spacer" />
          <Btn variant="ghost" size="sm" icon="arrow-left" onClick={() => go('title')}>
            Back
          </Btn>
        </div>

        <div>
          <span className="eyebrow">Desk chair preferences</span>
          <h1 className="page__title" style={{ marginTop: 4 }}>
            Settings
          </h1>
        </div>

        <section className="settings__group">
          <h2>Play</h2>
          <div className="setting-row">
            <span
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 34,
                height: 34,
                border: '1.5px solid var(--ink)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--paper-3)',
                flex: 'none',
              }}
            >
              <Icon name={settings.sound ? 'volume' : 'volume-off'} size={17} />
            </span>
            <div className="setting-row__main">
              <div className="setting-row__title">Sound</div>
              <p className="setting-row__desc" id="sound-desc">
                Short pager and deploy blips, generated in the browser. No files, no downloads.
              </p>
            </div>
            <Toggle
              checked={settings.sound}
              onChange={(next) => updateSettings({ sound: next })}
              label={settings.sound ? 'On' : 'Off'}
              describedBy="sound-desc"
            />
          </div>

          <div className="setting-row">
            <span
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 34,
                height: 34,
                border: '1.5px solid var(--ink)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--paper-3)',
                flex: 'none',
              }}
            >
              <Icon name="motion" size={17} />
            </span>
            <div className="setting-row__main">
              <div className="setting-row__title">Reduced motion</div>
              <p className="setting-row__desc" id="motion-desc">
                Stops request dots, pulsing alerts, and drawer transitions. Your system still fails;
                it just does it quietly.
              </p>
            </div>
            <Toggle
              checked={settings.reducedMotion}
              onChange={(next) => updateSettings({ reducedMotion: next })}
              label={settings.reducedMotion ? 'On' : 'Off'}
              describedBy="motion-desc"
            />
          </div>

          <div className="setting-row">
            <span
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 34,
                height: 34,
                border: '1.5px solid var(--ink)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--paper-3)',
                flex: 'none',
              }}
            >
              <Icon name="bulb" size={17} />
            </span>
            <div className="setting-row__main">
              <div className="setting-row__title">Hints</div>
              <p className="setting-row__desc" id="hints-desc">
                Show a nudge in briefings and a first-run tip on the canvas. Turn off once you are
                comfortable being wrong.
              </p>
            </div>
            <Toggle
              checked={settings.showHints}
              onChange={(next) => updateSettings({ showHints: next })}
              label={settings.showHints ? 'On' : 'Off'}
              describedBy="hints-desc"
            />
          </div>
        </section>

        <section className="settings__group">
          <h2>Profile</h2>
          <div className="setting-row" style={{ display: 'grid', gap: 10 }}>
            <div className="profile-strip">
              <div className="profile-stat">
                <strong>{fmtNum(stars)}</strong>
                <span>stars earned</span>
              </div>
              <div className="profile-stat">
                <strong>
                  {profile.completed.length}/{CAMPAIGN_LEVELS.length || '—'}
                </strong>
                <span>shifts survived</span>
              </div>
              <div className="profile-stat">
                <strong>{best > 0 ? fmtNum(best) : '—'}</strong>
                <span>sandbox best</span>
              </div>
            </div>
            <p className="setting-row__desc">
              Saved to this browser only. Clearing site data removes it, which is also a valid way to
              start over.
            </p>
          </div>
        </section>

        <section className="settings__group">
          <h2>Danger zone</h2>
          <div className="setting-row">
            <div className="setting-row__main">
              <div className="setting-row__title">Reset progress</div>
              <p className="setting-row__desc">
                Clears stars, completions, unlocked components, and the sandbox high score. Settings
                stay as they are.
              </p>
            </div>
            <Btn
              variant={confirming ? 'danger' : 'outline'}
              icon="reset"
              onClick={() => {
                if (confirming) {
                  resetProgress();
                  setConfirming(false);
                } else {
                  setConfirming(true);
                  window.setTimeout(() => setConfirming(false), 4000);
                }
              }}
            >
              {confirming ? 'Yes, wipe it' : 'Reset progress'}
            </Btn>
          </div>
        </section>

        <p className="muted" style={{ fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="shield" size={13} />
          No accounts, no telemetry, no network calls. Everything happens in this tab.
        </p>
      </div>
    </div>
  );
}
