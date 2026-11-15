import { create } from 'zustand';
import { getSpec } from '@/sim/catalog';
import { createSimulation } from '@/sim/engine';
import type {
  ComponentKind,
  ConfigValue,
  GameEvent,
  NodeConfig,
  Postmortem,
  Profile,
  RequestTrace,
  RunbookKind,
  Scenario,
  Settings,
  SimSnapshot,
  Simulation,
  Topology,
  TopologyNode,
} from '@/sim/types';
import { buildPostmortem } from '@/content/postmortem';
import { createSandbox } from '@/content/sandbox';
import { CAMPAIGN_LEVELS, getLevel, nextLevel as findNextLevel } from '@/content/levels';
import {
  CAREER_STAGES,
  getCareerStage,
  isCareerUnlocked,
  nextCareerStage,
} from '@/content/career';
import { SCENARIOS, getScenario } from '@/content/scenarios';
import { computeSecurityScore } from '@/sim/security';
import { parseTopologyYaml, topologyToYaml } from '@/content/iac';
import { clearProfile, defaultProfile, loadProfile, saveProfile } from './save';
import {
  cloneTopology,
  createLink,
  createNode,
  defaultPlacement,
  fitNodePosition,
  validateTopology,
  type Placement,
  type ValidationIssue,
} from './topology';

export type Screen = 'title' | 'campaign' | 'career' | 'scenarios' | 'game' | 'howto' | 'settings';
export type Phase = 'briefing' | 'running' | 'paused' | 'ended';
export type InspectorTab = 'config' | 'yaml';
export type RunMode = 'campaign' | 'career' | 'scenario' | 'sandbox';

export type AlertMetric = 'errorRate' | 'p95' | 'maxQueue' | 'availability' | 'security';

export interface AlertRule {
  id: string;
  label: string;
  metric: AlertMetric;
  operator: '>' | '<';
  threshold: number;
  enabled: boolean;
}

export interface FiredAlert {
  id: string;
  ruleId: string;
  label: string;
  at: number;
  value: number;
  severity: 'warning' | 'critical';
  acknowledged: boolean;
}

export type PanelKey =
  | 'dashboardOpen'
  | 'iacOpen'
  | 'helpOpen'
  | 'incidentOpen'
  | 'postmortemOpen'
  | 'paletteOpen'
  | 'sandboxSetupOpen'
  | 'dashboard'
  | 'iac'
  | 'help'
  | 'incident'
  | 'postmortem'
  | 'palette'
  | 'sandboxSetup';

type BooleanPanelKey =
  | 'dashboardOpen'
  | 'iacOpen'
  | 'helpOpen'
  | 'incidentOpen'
  | 'postmortemOpen'
  | 'paletteOpen'
  | 'sandboxSetupOpen';

const PANEL_TARGETS: Record<PanelKey, BooleanPanelKey> = {
  dashboardOpen: 'dashboardOpen',
  iacOpen: 'iacOpen',
  helpOpen: 'helpOpen',
  incidentOpen: 'incidentOpen',
  postmortemOpen: 'postmortemOpen',
  paletteOpen: 'paletteOpen',
  sandboxSetupOpen: 'sandboxSetupOpen',
  dashboard: 'dashboardOpen',
  iac: 'iacOpen',
  help: 'helpOpen',
  incident: 'incidentOpen',
  postmortem: 'postmortemOpen',
  palette: 'paletteOpen',
  sandboxSetup: 'sandboxSetupOpen',
};

export interface UiState {
  dashboardOpen: boolean;
  iacOpen: boolean;
  helpOpen: boolean;
  incidentOpen: boolean;
  postmortemOpen: boolean;
  paletteOpen: boolean;
  sandboxSetupOpen: boolean;
  inspectorTab: InspectorTab;
  yamlText: string;
  yamlErrors: string[];
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'danger' | 'warning';
}

export type NodePatch = Partial<Pick<TopologyNode, 'name' | 'cloudId' | 'regionId' | 'zoneId'>> & {
  config?: NodeConfig;
};

export interface GameStore {
  screen: Screen;
  profile: Profile;
  scenario: Scenario | null;
  levelId: string | null;
  runMode: RunMode;
  phase: Phase;
  speed: number;
  draft: Topology | null;
  deployed: Topology | null;
  sim: Simulation | null;
  snapshot: SimSnapshot | null;
  events: GameEvent[];
  traces: RequestTrace[];
  postmortem: Postmortem | null;
  deployPending: boolean;
  selectedNodeId: string | null;
  selectedLinkId: string | null;
  linkFrom: string | null;
  issues: ValidationIssue[];
  unreadAlerts: number;
  alertRules: AlertRule[];
  firedAlerts: FiredAlert[];
  firingAlertIds: string[];
  ui: UiState;
  toast: Toast | null;

  go: (screen: Screen) => void;
  openLevel: (id: string) => void;
  openCareerStage: (id: string) => void;
  openScenario: (id: string) => void;
  openSandbox: (difficulty?: 'relaxed' | 'normal' | 'chaos') => void;
  closeGame: () => void;
  startRun: () => void;
  pause: () => void;
  resume: () => void;
  setSpeed: (speed: number) => void;
  endRun: () => void;
  retry: () => void;
  nextLevel: () => void;

  selectNode: (id: string | null) => void;
  selectLink: (id: string | null) => void;
  beginLink: (id: string) => void;
  completeLink: (toId: string) => void;
  cancelLink: () => void;
  addNode: {
    (kind: ComponentKind, x: number, y: number, placement?: Placement): void;
    (kind: ComponentKind, placement: Placement, x: number, y: number): void;
  };
  moveNode: (id: string, x: number, y: number) => void;
  updateNode: (id: string, patch: NodePatch) => void;
  updateConfig: (id: string, key: string, value: ConfigValue) => void;
  deleteNode: (id: string) => void;
  deleteLink: (id: string) => void;
  deploy: () => void;

  togglePanel: (key: PanelKey) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  openIac: () => void;
  setYamlText: (text: string) => void;
  applyYaml: () => void;
  runRunbook: (kind: RunbookKind, targetId?: string) => void;
  updateAlertRule: (id: string, patch: Partial<Omit<AlertRule, 'id'>>) => void;
  toggleAlertRule: (id: string) => void;
  acknowledgeAlert: (id: string) => void;
  clearFiredAlerts: () => void;

  advance: (dt: number) => void;
  refreshSnapshot: () => void;
  pushEvent: (event: GameEvent) => void;
  notify: (message: string, tone?: Toast['tone'] | 'error') => void;
  dismissToast: () => void;
  saveProfile: () => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetProgress: () => void;
}

const orderedLevels = [...CAMPAIGN_LEVELS].sort((a, b) => a.act - b.act || a.order - b.order);

export function isLevelUnlocked(profile: Profile, levelId: string): boolean {
  const index = orderedLevels.findIndex((level) => level.id === levelId);
  if (index <= 0) return index === 0;
  return profile.completed.includes(orderedLevels[index - 1]!.id);
}

export function levelStars(profile: Profile, levelId: string): number {
  return profile.stars[levelId] ?? 0;
}

function defaultAlertRules(): AlertRule[] {
  return [
    { id: 'error-rate', label: 'Error rate', metric: 'errorRate', operator: '>', threshold: 1, enabled: true },
    { id: 'p95', label: 'p95 latency', metric: 'p95', operator: '>', threshold: 250, enabled: true },
    { id: 'queue', label: 'Any request queue', metric: 'maxQueue', operator: '>', threshold: 0, enabled: true },
    {
      id: 'availability',
      label: 'Availability',
      metric: 'availability',
      operator: '<',
      threshold: 99.9,
      enabled: true,
    },
    { id: 'security', label: 'Security score', metric: 'security', operator: '<', threshold: 25, enabled: true },
  ];
}

function alertValue(metric: AlertMetric, snapshot: SimSnapshot, topology: Topology | null): number {
  switch (metric) {
    case 'errorRate':
      return snapshot.errorRate * 100;
    case 'p95':
      return snapshot.p95;
    case 'maxQueue':
      return Math.max(0, ...Object.values(snapshot.nodes).map((node) => node.queue));
    case 'availability':
      return snapshot.availability * 100;
    case 'security':
      return topology ? computeSecurityScore(topology) : 0;
    default:
      return 0;
  }
}

function describeAlert(rule: AlertRule, value: number): string {
  const suffix =
    rule.metric === 'errorRate' || rule.metric === 'availability'
      ? '%'
      : rule.metric === 'p95'
        ? 'ms'
        : rule.metric === 'security'
          ? '/100'
          : '';
  const rounded = rule.metric === 'errorRate' || rule.metric === 'maxQueue' ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rule.label} is ${rounded}${suffix} (${rule.operator} ${rule.threshold}${suffix})`;
}

function initialUi(): UiState {
  return {
    dashboardOpen: false,
    iacOpen: false,
    helpOpen: false,
    incidentOpen: false,
    postmortemOpen: false,
    paletteOpen: false,
    sandboxSetupOpen: false,
    inspectorTab: 'config',
    yamlText: '',
    yamlErrors: [],
  };
}

let toastSeq = 0;
let alertSeq = 0;
let lastSnapshotAt = 0;

export const useGame = create<GameStore>()((set, get) => {
  const commitDraft = (next: Topology): void => {
    const { draft, scenario, phase } = get();
    if (!draft || !scenario) return;
    const issues = validateTopology(next, scenario.world, {
      requiresDatabase: scenario.requiresDatabase,
    });
    set({
      draft: next,
      issues,
      deployPending: true,
      phase: phase === 'running' ? 'paused' : phase,
    });
  };

  const resetRun = (
    scenario: Scenario,
    levelId: string,
    runMode: RunMode,
    screen: Screen = 'game',
  ): void => {
    const draft = cloneTopology(scenario.initialTopology);
    const issues = validateTopology(draft, scenario.world, {
      requiresDatabase: scenario.requiresDatabase,
    });
    set({
      screen,
      scenario,
      levelId,
      runMode,
      phase: 'briefing',
      speed: 1,
      draft,
      deployed: cloneTopology(draft),
      sim: null,
      snapshot: null,
      events: [],
      traces: [],
      postmortem: null,
      deployPending: false,
      selectedNodeId: null,
      selectedLinkId: null,
      linkFrom: null,
      issues,
      unreadAlerts: 0,
      alertRules: defaultAlertRules(),
      firedAlerts: [],
      firingAlertIds: [],
      ui: {
        ...initialUi(),
        yamlText: safeYaml(draft, scenario),
      },
      toast: null,
    });
    lastSnapshotAt = 0;
  };

  const evaluateAlerts = (snapshot: SimSnapshot): void => {
    const { alertRules, scenario, deployed, draft, firingAlertIds } = get();
    if (!scenario) return;
    const topology = deployed ?? draft ?? scenario.initialTopology;
    const nextFiring: string[] = [];
    const newAlerts: FiredAlert[] = [];

    for (const rule of alertRules) {
      if (!rule.enabled) continue;
      const value = alertValue(rule.metric, snapshot, topology);
      const firing = rule.operator === '>' ? value > rule.threshold : value < rule.threshold;
      if (!firing) continue;
      nextFiring.push(rule.id);
      if (firingAlertIds.includes(rule.id)) continue;

      const alert: FiredAlert = {
        id: `${rule.id}-${Math.floor(snapshot.time)}-${++alertSeq}`,
        ruleId: rule.id,
        label: rule.label,
        at: snapshot.time,
        value,
        severity: rule.metric === 'availability' || rule.metric === 'security' ? 'critical' : 'warning',
        acknowledged: false,
      };
      newAlerts.push(alert);
      get().pushEvent({
        id: `alert-event-${alert.id}`,
        at: snapshot.time,
        kind: 'alert',
        severity: alert.severity,
        title: `Alert: ${rule.label}`,
        message: describeAlert(rule, value),
      });
    }

    const changed =
      newAlerts.length > 0 ||
      nextFiring.length !== firingAlertIds.length ||
      nextFiring.some((id) => !firingAlertIds.includes(id));
    if (!changed) return;

    set({
      firingAlertIds: nextFiring,
      firedAlerts: newAlerts.length > 0 ? [...newAlerts, ...get().firedAlerts].slice(0, 50) : get().firedAlerts,
    });
    for (const alert of newAlerts) {
      const rule = alertRules.find((candidate) => candidate.id === alert.ruleId);
      get().notify(
        rule ? describeAlert(rule, alert.value) : `${alert.label} threshold crossed`,
        alert.severity === 'critical' ? 'danger' : 'warning',
      );
    }
  };

  return {
    screen: 'title',
    profile: loadProfile(),
    scenario: null,
    levelId: null,
    runMode: 'campaign',
    phase: 'briefing',
    speed: 1,
    draft: null,
    deployed: null,
    sim: null,
    snapshot: null,
    events: [],
    traces: [],
    postmortem: null,
    deployPending: false,
    selectedNodeId: null,
    selectedLinkId: null,
    linkFrom: null,
    issues: [],
    unreadAlerts: 0,
    alertRules: defaultAlertRules(),
    firedAlerts: [],
    firingAlertIds: [],
    ui: initialUi(),
    toast: null,

    go: (screen) => set({ screen }),

    openLevel: (id) => {
      const level = getLevel(id);
      if (!level) {
        get().notify('That level does not exist.', 'error');
        return;
      }
      if (!isLevelUnlocked(get().profile, level.id)) {
        get().notify('Finish the previous level first. Reliability is a series.', 'error');
        return;
      }
      resetRun(level, level.id, 'campaign');
    },

    openCareerStage: (id) => {
      const stage = getCareerStage(id);
      if (!stage) {
        get().notify('That career stage does not exist.', 'error');
        return;
      }
      if (!isCareerUnlocked(get().profile, stage.id)) {
        get().notify('Finish the previous career stage first.', 'error');
        return;
      }
      resetRun(stage, stage.id, 'career');
    },

    openScenario: (id) => {
      const scenario = getScenario(id);
      if (!scenario) {
        get().notify('That scenario does not exist.', 'error');
        return;
      }
      resetRun(scenario, scenario.id, 'scenario');
    },

    openSandbox: (difficulty = 'normal') => {
      const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
      const scenario = createSandbox(difficulty, seed);
      resetRun(scenario, scenario.id, 'sandbox');
    },

    closeGame: () =>
      set({
        screen: 'campaign',
        scenario: null,
        levelId: null,
        runMode: 'campaign',
        sim: null,
        snapshot: null,
        draft: null,
        deployed: null,
        postmortem: null,
        events: [],
        traces: [],
        selectedNodeId: null,
        selectedLinkId: null,
        linkFrom: null,
        deployPending: false,
        ui: initialUi(),
      }),

    startRun: () => {
      const { scenario, draft, phase, sim, profile, deployPending } = get();
      if (!scenario || !draft) return;
      if (phase === 'ended') return;
      if (sim) {
        if (deployPending) {
          get().notify('Deploy the pending changes before resuming.', 'info');
          return;
        }
        set({ phase: 'running' });
        lastSnapshotAt = 0;
        return;
      }
      const issues = validateTopology(draft, scenario.world, {
        requiresDatabase: scenario.requiresDatabase,
      });
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        set({ issues });
        get().notify(errors[0]!.message, 'error');
        return;
      }
      set({
        phase: 'running',
        deployed: cloneTopology(draft),
        deployPending: false,
        events: [],
        traces: [],
        postmortem: null,
        unreadAlerts: 0,
        issues,
        ui: { ...get().ui, incidentOpen: false, postmortemOpen: false },
        profile,
      });
      lastSnapshotAt = 0;
      const nextSim = createSimulation(scenario, cloneTopology(draft), {
        onEvent: (event) => get().pushEvent(event),
      });
      nextSim.start();
      set({ sim: nextSim, snapshot: nextSim.snapshot() });
    },

    pause: () => {
      const { phase, sim } = get();
      if (phase !== 'running' || !sim) return;
      set({ phase: 'paused', snapshot: sim.snapshot(), traces: sim.traces() });
    },

    resume: () => {
      const { phase, sim, deployPending } = get();
      if (phase !== 'paused' || !sim) return;
      if (deployPending) {
        get().notify('Deploy the pending changes before resuming.', 'info');
        return;
      }
      set({ phase: 'running' });
      lastSnapshotAt = 0;
    },

    setSpeed: (speed) => {
      if ([1, 2, 5, 10].includes(speed)) set({ speed });
    },

    endRun: () => {
      const { sim, scenario, events, deployed, profile, phase, ui, runMode } = get();
      if (!sim || !scenario || !deployed || phase === 'ended') return;
      const snapshot = sim.snapshot();
      const traces = sim.traces();
      const postmortem = buildPostmortem(scenario, snapshot, events, deployed);
      let nextProfile = profile;
      if (postmortem.outcome === 'success') {
        if (runMode === 'sandbox') {
          const score = Math.round(
            postmortem.metrics.availability * 10000 +
              postmortem.stars * 1000 +
              Math.max(0, snapshot.time - postmortem.metrics.errorSeconds),
          );
          nextProfile = { ...profile, sandboxBest: Math.max(profile.sandboxBest, score) };
        } else {
          const stars = Math.max(profile.stars[scenario.id] ?? 0, postmortem.stars);
          nextProfile = {
            ...profile,
            stars: { ...profile.stars, [scenario.id]: stars },
            completed: profile.completed.includes(scenario.id)
              ? profile.completed
              : [...profile.completed, scenario.id],
            unlocked: [
              ...new Set([...profile.unlocked, ...(scenario.unlockOnComplete ?? [])]),
            ],
          };
        }
        saveProfile(nextProfile);
      }
      set({
        phase: 'ended',
        snapshot,
        traces,
        postmortem,
        sim: null,
        profile: nextProfile,
        ui: { ...ui, incidentOpen: false, postmortemOpen: true },
      });
    },

    retry: () => {
      const { scenario, levelId, runMode } = get();
      if (!scenario) return;
      if (runMode === 'sandbox') {
        resetRun(createSandbox(scenario.difficulty ?? 'normal', scenario.seed), scenario.id, 'sandbox');
        return;
      }
      if (runMode === 'career' && levelId) {
        get().openCareerStage(levelId);
        return;
      }
      if (runMode === 'scenario' && levelId) {
        get().openScenario(levelId);
        return;
      }
      if (levelId) get().openLevel(levelId);
    },

    nextLevel: () => {
      const { scenario, levelId, runMode } = get();
      if (runMode === 'sandbox') {
        get().go('campaign');
        return;
      }
      if (runMode === 'career') {
        const next = levelId ? nextCareerStage(levelId) : undefined;
        if (next && isCareerUnlocked(get().profile, next.id)) resetRun(next, next.id, 'career');
        else get().go('career');
        return;
      }
      if (runMode === 'scenario') {
        get().go('scenarios');
        return;
      }
      const next = levelId ? findNextLevel(levelId) : undefined;
      if (next && isLevelUnlocked(get().profile, next.id)) resetRun(next, next.id, 'campaign');
      else get().go('campaign');
    },

    selectNode: (id) => set({ selectedNodeId: id, selectedLinkId: null }),
    selectLink: (id) => set({ selectedLinkId: id, selectedNodeId: null }),

    beginLink: (id) => {
      if (get().draft?.nodes.some((node) => node.id === id)) {
        set({ linkFrom: id, selectedNodeId: id, selectedLinkId: null });
      }
    },

    completeLink: (toId) => {
      const { draft, linkFrom } = get();
      if (!draft || !linkFrom) return;
      const link = createLink(linkFrom, toId, draft);
      if (!link) {
        set({ linkFrom: null });
        get().notify('That link already exists, or it cannot be created.', 'error');
        return;
      }
      const next = { ...draft, links: [...draft.links, link] };
      const issues = validateTopology(next, get().scenario!.world, {
        requiresDatabase: get().scenario?.requiresDatabase,
      });
      if (issues.some((issue) => issue.id === 'cycle')) {
        set({ linkFrom: null });
        get().notify('That link would create a loop. Pick another target.', 'error');
        return;
      }
      set({
        linkFrom: null,
        selectedNodeId: toId,
        selectedLinkId: null,
      });
      commitDraft(next);
    },

    cancelLink: () => set({ linkFrom: null }),

    addNode: (kind, a, b, c) => {
      const { draft, scenario, phase } = get();
      if (!draft || !scenario) return;
      if (!scenario.unlockedKinds.includes(kind)) {
        get().notify(`${getSpec(kind).label} is locked. Finish more levels first.`, 'error');
        return;
      }
      const placement = (typeof a === 'object' && a !== null ? a : c) as Placement | undefined;
      const x = (typeof a === 'object' && a !== null ? b : a) as number;
      const y = (typeof a === 'object' && a !== null ? c : b) as number;
      const fit = fitNodePosition(x, y, 1200, 700, getSpec(kind).scope === 'global' ? -500 : 40);
      const node = createNode(
        kind,
        defaultPlacement(kind, scenario.world, placement),
        fit.x,
        fit.y,
        draft,
      );
      const next = { ...draft, nodes: [...draft.nodes, node] };
      const issues = validateTopology(next, scenario.world, {
        requiresDatabase: scenario.requiresDatabase,
      });
      set({
        draft: next,
        issues,
        deployPending: true,
        phase: phase === 'running' ? 'paused' : phase,
        selectedNodeId: node.id,
        selectedLinkId: null,
      });
      get().notify(`${specLabel(kind)} added. Connect it to the flow.`, 'info');
    },

    moveNode: (id, x, y) => {
      const { draft } = get();
      if (!draft) return;
      const nodes = draft.nodes.map((node) => {
        if (node.id !== id) return node;
        const fit = fitNodePosition(x, y, 1200, 700, getSpec(node.kind).scope === 'global' ? -500 : 40);
        return { ...node, x: fit.x, y: fit.y };
      });
      set({ draft: { ...draft, nodes } });
    },

    updateNode: (id, patch) => {
      const { draft, scenario } = get();
      if (!draft || !scenario) return;
      const nodes = draft.nodes.map((node) => {
        if (node.id !== id) return node;
        const next: TopologyNode = {
          ...node,
          ...patch,
          config: patch.config ? { ...node.config, ...patch.config } : node.config,
        };
        const spec = getSpec(node.kind);
        if (spec.scope === 'global') {
          delete next.cloudId;
          delete next.regionId;
          delete next.zoneId;
        } else if (patch.regionId) {
          const region = scenario.world.regions.find((candidate) => candidate.id === patch.regionId);
          next.regionId = patch.regionId;
          next.cloudId = region?.cloudId;
          if (spec.scope === 'zonal' && region && !region.zones.some((zone) => zone.id === next.zoneId)) {
            next.zoneId = region.zones[0]?.id;
          }
        }
        if (patch.zoneId) next.zoneId = patch.zoneId;
        if (patch.cloudId) next.cloudId = patch.cloudId;
        return next;
      });
      commitDraft({ ...draft, nodes });
    },

    updateConfig: (id, key, value) => {
      const { draft } = get();
      if (!draft) return;
      const nodes = draft.nodes.map((node) =>
        node.id === id ? { ...node, config: { ...node.config, [key]: value } } : node,
      );
      commitDraft({ ...draft, nodes });
    },

    deleteNode: (id) => {
      const { draft, scenario, phase } = get();
      if (!draft || !scenario) return;
      const next = {
        nodes: draft.nodes.filter((node) => node.id !== id),
        links: draft.links.filter((link) => link.from !== id && link.to !== id),
      };
      const issues = validateTopology(next, scenario.world, {
        requiresDatabase: scenario.requiresDatabase,
      });
      set({
        draft: next,
        issues,
        deployPending: true,
        phase: phase === 'running' ? 'paused' : phase,
        selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
        selectedLinkId: null,
        linkFrom: get().linkFrom === id ? null : get().linkFrom,
      });
    },

    deleteLink: (id) => {
      const { draft, scenario, phase } = get();
      if (!draft || !scenario) return;
      const next = { ...draft, links: draft.links.filter((link) => link.id !== id) };
      const issues = validateTopology(next, scenario.world, {
        requiresDatabase: scenario.requiresDatabase,
      });
      set({
        draft: next,
        issues,
        deployPending: true,
        phase: phase === 'running' ? 'paused' : phase,
        selectedLinkId: get().selectedLinkId === id ? null : get().selectedLinkId,
      });
    },

    deploy: () => {
      const { draft, scenario, sim, phase } = get();
      if (!draft || !scenario) return;
      const issues = validateTopology(draft, scenario.world, {
        requiresDatabase: scenario.requiresDatabase,
      });
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        set({ issues });
        get().notify(errors[0]!.message, 'error');
        return;
      }
      const deployed = cloneTopology(draft);
      if (sim) sim.applyTopology(cloneTopology(draft));
      set({
        deployed,
        deployPending: false,
        issues,
        phase: phase === 'running' ? 'paused' : phase,
        snapshot: sim ? sim.snapshot() : get().snapshot,
        traces: sim ? sim.traces() : get().traces,
      });
      get().notify('Changes deployed. The pager is watching.', 'success');
    },

    togglePanel: (key) => {
      const { ui, scenario, draft } = get();
      const target = PANEL_TARGETS[key];
      const next = { ...ui, [target]: !ui[target] };
      if (target === 'incidentOpen' && next.incidentOpen) {
        set({ unreadAlerts: 0 });
      }
      if (target === 'iacOpen' && next.iacOpen && scenario && draft) {
        next.yamlText = safeYaml(draft, scenario);
        next.yamlErrors = [];
      }
      set({ ui: next });
    },

    setInspectorTab: (tab) => set({ ui: { ...get().ui, inspectorTab: tab } }),
    openIac: () => {
      const { scenario, draft, ui } = get();
      if (!scenario || !draft) return;
      set({
        ui: {
          ...ui,
          iacOpen: true,
          yamlText: safeYaml(draft, scenario),
          yamlErrors: [],
        },
      });
    },
    setYamlText: (text) => set({ ui: { ...get().ui, yamlText: text } }),

    applyYaml: () => {
      const { scenario, draft, ui } = get();
      if (!scenario || !draft) return;
      const result = parseTopologyYaml(ui.yamlText, scenario.world, draft);
      if (!result.topology) {
        set({ ui: { ...ui, yamlErrors: result.errors } });
        get().notify('The manifest has errors. Check the list.', 'error');
        return;
      }
      const issues = validateTopology(result.topology, scenario.world, {
        requiresDatabase: scenario.requiresDatabase,
      });
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        set({ ui: { ...ui, yamlErrors: errors.map((issue) => issue.message) } });
        get().notify(errors[0]!.message, 'error');
        return;
      }
      commitDraft(result.topology);
      set({ ui: { ...get().ui, yamlErrors: [] } });
      get().notify('Manifest applied to the draft. Deploy to make it live.', 'success');
    },

    runRunbook: (kind, targetId) => {
      const { sim } = get();
      if (!sim) {
        get().notify('Start the shift before using a runbook.', 'error');
        return;
      }
      const result = sim.runRunbook(kind, targetId);
      get().notify(result.message, result.ok ? 'success' : 'error');
      get().refreshSnapshot();
    },

    updateAlertRule: (id, patch) => {
      set({
        alertRules: get().alertRules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
      });
    },

    toggleAlertRule: (id) => {
      set({
        alertRules: get().alertRules.map((rule) =>
          rule.id === id ? { ...rule, enabled: !rule.enabled } : rule,
        ),
      });
    },

    acknowledgeAlert: (id) => {
      set({
        firedAlerts: get().firedAlerts.map((alert) =>
          alert.id === id ? { ...alert, acknowledged: true } : alert,
        ),
      });
    },

    clearFiredAlerts: () => set({ firedAlerts: [] }),

    advance: (dt) => {
      const state = get();
      if (!state.sim || state.phase !== 'running') return;
      state.sim.tick(Math.max(0, Math.min(dt, 5)));
      const sim = get().sim;
      if (!sim) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // A critical incident auto-pauses the run from inside `tick()`. Force a
      // fresh snapshot in that case so the pager modal sees the active incident
      // instead of the previous, pre-incident frame.
      if (now - lastSnapshotAt >= 80 || sim.ended || get().phase !== 'running') {
        lastSnapshotAt = now;
        const snapshot = sim.snapshot();
        set({ snapshot, traces: sim.traces() });
        evaluateAlerts(snapshot);
      }
      if (sim.ended) get().endRun();
    },

    refreshSnapshot: () => {
      const { sim } = get();
      if (!sim) return;
      const snapshot = sim.snapshot();
      set({ snapshot, traces: sim.traces() });
      evaluateAlerts(snapshot);
      if (sim.ended) get().endRun();
    },

    pushEvent: (event) => {
      const state = get();
      const critical = event.kind === 'incident' && event.severity === 'critical';
      set({
        events: [...state.events, event].slice(-400),
        unreadAlerts: event.kind === 'incident' ? state.unreadAlerts + 1 : state.unreadAlerts,
        phase: critical && state.phase === 'running' ? 'paused' : state.phase,
      });
    },

    notify: (message, tone = 'info') => {
      const normalized = tone === 'error' ? 'danger' : tone;
      set({ toast: { id: ++toastSeq, message, tone: normalized } });
    },
    dismissToast: () => set({ toast: null }),
    saveProfile: () => saveProfile(get().profile),

    setSetting: (key, value) => {
      const profile = { ...get().profile, settings: { ...get().profile.settings, [key]: value } };
      set({ profile });
      saveProfile(profile);
    },

    updateSettings: (patch) => {
      const profile = {
        ...get().profile,
        settings: { ...get().profile.settings, ...patch },
      };
      set({ profile });
      saveProfile(profile);
    },

    resetProgress: () => {
      clearProfile();
      set({
        profile: defaultProfile(),
        screen: 'title',
        scenario: null,
        levelId: null,
        runMode: 'campaign',
        sim: null,
        snapshot: null,
        draft: null,
        deployed: null,
        postmortem: null,
        events: [],
        traces: [],
        selectedNodeId: null,
        selectedLinkId: null,
        linkFrom: null,
        deployPending: false,
        issues: [],
        unreadAlerts: 0,
        alertRules: defaultAlertRules(),
        firedAlerts: [],
        firingAlertIds: [],
        ui: initialUi(),
        toast: null,
      });
    },
  };
});

function safeYaml(topology: Topology, scenario: Scenario): string {
  try {
    return topologyToYaml(topology, scenario.world);
  } catch {
    return '';
  }
}

function specLabel(kind: ComponentKind): string {
  return getSpec(kind).label;
}
