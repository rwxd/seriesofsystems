import { useEffect } from 'react';
import { useGame } from '@/game/store';
import { useSimLoop } from '@/game/loop';
import { TitleScreen } from '@/ui/screens/TitleScreen';
import { CampaignScreen } from '@/ui/screens/CampaignScreen';
import { HowToScreen } from '@/ui/screens/HowToScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { GameScreen } from '@/ui/game/GameScreen';
import { HelpModal } from '@/ui/game/modals/Help';
import { Toasts } from '@/ui/game/Toasts';
import { SandboxSetup } from '@/ui/components/SandboxSetup';

export function App() {
  useSimLoop();

  const screen = useGame((state) => state.screen);
  const reducedMotion = useGame((state) => state.profile.settings.reducedMotion);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full';
  }, [reducedMotion]);

  return (
    <div className="app-root">
      {screen === 'title' && <TitleScreen key="title" />}
      {screen === 'campaign' && <CampaignScreen key="campaign" />}
      {screen === 'howto' && <HowToScreen key="howto" />}
      {screen === 'settings' && <SettingsScreen key="settings" />}
      {screen === 'game' && <GameScreen key="game" />}

      <SandboxSetup />
      <HelpModal />
      <Toasts />
    </div>
  );
}
