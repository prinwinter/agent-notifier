import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type NotifyKind = 'stop' | 'attention';

const LABEL: Record<NotifyKind, string> = {
  stop: 'Agent stopped',
  attention: 'Agent needs attention',
};

function resolveHookPath(cfg: vscode.WorkspaceConfiguration): string {
  return cfg.get<string>('hookFilePath', '').trim()
    || path.join(os.tmpdir(), 'agent-notifier.jsonl');
}

class HookWatcher implements vscode.Disposable {
  private lastSize = 0;
  private filePath = '';
  private cooldownUntil = 0;
  private watching = false;
  private readonly cfgListener: vscode.Disposable;

  constructor(private cb: (kind: NotifyKind) => void) {
    this.start();
    this.cfgListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentNotifier.hookFilePath') ||
          e.affectsConfiguration('agentNotifier.hookEnabled')) {
        this.stop();
        this.start();
      }
    });
  }

  private start() {
    const cfg = vscode.workspace.getConfiguration('agentNotifier');
    if (!cfg.get<boolean>('hookEnabled', true)) return;
    this.filePath = resolveHookPath(cfg);
    try { this.lastSize = fs.statSync(this.filePath).size; } catch { this.lastSize = 0; }
    try {
      fs.watchFile(this.filePath, { interval: 1000 }, () => this.onChange());
      this.watching = true;
    } catch { /* */ }
  }

  private stop() {
    if (this.watching) { fs.unwatchFile(this.filePath); this.watching = false; }
  }

  private onChange() {
    const cfg = vscode.workspace.getConfiguration('agentNotifier');
    if (!cfg.get<boolean>('enabled', true)) return;
    const cooldown = cfg.get<number>('cooldownSeconds', 3) * 1000;
    let fd: number | undefined;
    try {
      const size = fs.statSync(this.filePath).size;
      if (size < this.lastSize) this.lastSize = 0;
      if (size <= this.lastSize) return;
      fd = fs.openSync(this.filePath, 'r');
      const buf = Buffer.alloc(size - this.lastSize);
      fs.readSync(fd, buf, 0, buf.length, this.lastSize);
      this.lastSize = size;

      const now = Date.now();
      for (const line of buf.toString('utf-8').split('\n').filter(Boolean)) {
        try {
          const evt = JSON.parse(line);
          if (now < this.cooldownUntil) continue;
          const kind: NotifyKind = (evt.event === 'notification' || evt.event === 'permission_request') ? 'attention' : 'stop';
          this.cb(kind);
          this.cooldownUntil = now + cooldown;
        } catch { /* ignore malformed */ }
      }
    } catch {
      this.lastSize = 0;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* */ }
    }
  }

  dispose() {
    this.stop();
    this.cfgListener.dispose();
  }
}

class AudioViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'agentNotifier.soundPanel';
  private view?: vscode.WebviewView;

  resolveWebviewView(wv: vscode.WebviewView) {
    this.view = wv;
    wv.webview.options = { enableScripts: true };
    wv.webview.html = PLAYER_HTML;
    wv.webview.onDidReceiveMessage((m) => {
      if (m.type === 'ready') {
        const enabled = vscode.workspace.getConfiguration('agentNotifier').get<boolean>('enabled', true);
        wv.webview.postMessage({ type: 'state', enabled });
      }
      if (m.type === 'toggle') {
        vscode.workspace.getConfiguration('agentNotifier').update('enabled', m.on, vscode.ConfigurationTarget.Global);
      }
    });
    wv.onDidDispose(() => { this.view = undefined; });
  }

  playSound(sound: 'complete' | 'input') {
    if (!this.view) return;
    const vol = vscode.workspace.getConfiguration('agentNotifier').get<number>('soundVolume', 0.5);
    this.view.webview.postMessage({ type: 'play', sound, volume: vol });
  }
}

const PLAYER_HTML = /*html*/ `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-panel-background); padding: 12px; font-size: 13px;
         display: flex; align-items: center; gap: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 6px 20px; cursor: pointer; border-radius: 2px; min-width: 70px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.off { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #info { opacity: .5; font-size: 12px; }
</style></head><body>
<button id="btn" class="off">OFF</button>
<span id="info">Click to activate</span>
<script>
const vs=acquireVsCodeApi();let ctx=null;let on=false;let cfgOn=false;
function ac(){if(!ctx)ctx=new AudioContext();if(ctx.state==='suspended')ctx.resume();return ctx;}
function ps(v,freq){const c=ac(),n=c.currentTime;
  const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=freq;
  o.connect(g);g.connect(c.destination);g.gain.setValueAtTime(0,n);
  g.gain.linearRampToValueAtTime(v*.4,n+.02);g.gain.exponentialRampToValueAtTime(.001,n+.3);
  o.start(n);o.stop(n+.32);}
function update(){const b=document.getElementById('btn'),i=document.getElementById('info');
  b.textContent=on?'ON':'OFF';b.className=on?'':'off';
  i.textContent=on?'Listening...':(cfgOn?'Click to resume sound':'Click to activate');}
document.getElementById('btn').onclick=()=>{
  if(on){on=false;cfgOn=false;vs.postMessage({type:'toggle',on:false});}
  else{ac();on=true;cfgOn=true;vs.postMessage({type:'toggle',on:true});ps(.3,880);}
  update();};
window.addEventListener('message',e=>{const m=e.data;
  if(m.type==='state'){cfgOn=!!m.enabled;update();}
  if(m.type==='play'){if(!on)return;
    ps(m.volume||.5, m.sound==='complete'?440:660);
    document.getElementById('info').textContent='Last: '+new Date().toLocaleTimeString();}});
vs.postMessage({type:'ready'});
</script></body></html>`;

let audio: AudioViewProvider;
let out: vscode.OutputChannel;

export function activate(ctx: vscode.ExtensionContext) {
  out = vscode.window.createOutputChannel('Agent Notifier');
  ctx.subscriptions.push(out);
  log('Activating…');

  audio = new AudioViewProvider();
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AudioViewProvider.viewType, audio, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    new HookWatcher(onNotify),
    vscode.commands.registerCommand('agentNotifier.setupHooks', setupHooksCmd),
  );

  log('Activated');
}

export function deactivate() {}

function onNotify(kind: NotifyKind) {
  const cfg = vscode.workspace.getConfiguration('agentNotifier');
  if (!cfg.get<boolean>('enabled', true)) return;
  log(LABEL[kind]);

  if (cfg.get<boolean>('soundEnabled', true)) {
    audio.playSound(kind === 'attention' ? 'input' : 'complete');
  }
  if (cfg.get<boolean>('showNotificationMessage', false)) {
    kind === 'attention'
      ? vscode.window.showWarningMessage(LABEL[kind], 'Dismiss')
      : vscode.window.showInformationMessage(LABEL[kind], 'Dismiss');
  }
}

function setupHooksCmd() {
  const hookFilePath = resolveHookPath(vscode.workspace.getConfiguration('agentNotifier'));
  const claudeSettings = path.join(os.homedir(), '.claude', 'settings.json');
  const codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
  const results: string[] = [];

  // --- Claude Code (settings.json) ---
  try {
    const cmd = (ev: string) => `printf '{"event":"${ev}","ts":%d}\\n' "$(date +%s)" >> "${hookFilePath}"`;
    let settings: any = {};
    try { settings = JSON.parse(fs.readFileSync(claudeSettings, 'utf-8')); } catch { /* */ }
    if (!settings.hooks) settings.hooks = {};

    for (const [key, hook] of Object.entries({ Stop: cmd('stop'), Notification: cmd('notification'), PermissionRequest: cmd('permission_request') })) {
      const arr: any[] = settings.hooks[key] || [];
      const already = arr.some((h: any) => JSON.stringify(h).includes(hookFilePath));
      if (!already) {
        arr.push({ matcher: '', hooks: [{ type: 'command', command: hook }] });
      }
      settings.hooks[key] = arr;
    }

    const dir = path.dirname(claudeSettings);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(claudeSettings, JSON.stringify(settings, null, 2));
    results.push(`Claude → ${claudeSettings}`);
  } catch (err: any) {
    results.push(`Claude failed: ${err.message}`);
  }

  // --- Codex (config.toml) ---
  // Codex passes the event JSON as the final arg to notify[]. We use
  // `sh -c '<script>' _ <json>` so $1 is the JSON payload in the script.
  // notify must be top-level (before any [section]) — Codex ignores it inside tables.
  // Note: Codex's notify only fires for `agent-turn-complete`, not approval requests.
  try {
    let existing = '';
    try { existing = fs.readFileSync(codexConfig, 'utf-8'); } catch { /* */ }

    // Split file into top-level scope and the rest.
    const firstSection = existing.match(/(?:^|\n)\[/);
    const insertAt = firstSection
      ? firstSection.index! + (firstSection[0].startsWith('\n') ? 1 : 0)
      : existing.length;
    const before = existing.slice(0, insertAt);
    const after = existing.slice(insertAt);
    const hasNotify = /^\s*notify\s*=/m.test(before);

    if (hasNotify && before.includes(hookFilePath)) {
      results.push(`Codex → already configured`);
    } else if (hasNotify) {
      results.push(`Codex skipped (existing notify= in ${codexConfig})`);
    } else {
      const notifyLine = `notify = ["sh", "-c", "printf '%s\\\\n' \\"$1\\" >> \\"${hookFilePath}\\"", "_"]`;
      const dir = path.dirname(codexConfig);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const sep = before && !before.endsWith('\n') ? '\n' : '';
      fs.writeFileSync(codexConfig, before + sep + notifyLine + '\n' + after);
      results.push(`Codex → ${codexConfig}`);
    }
  } catch (err: any) {
    results.push(`Codex failed: ${err.message}`);
  }

  log(`Hook setup: ${results.join(' · ')}`);
  vscode.window.showInformationMessage(
    `Hooks → ${hookFilePath} · ${results.join(' · ')}`,
    'Open Claude', 'Open Codex',
  ).then((c) => {
    const target = c === 'Open Claude' ? claudeSettings : c === 'Open Codex' ? codexConfig : undefined;
    if (target) {
      vscode.workspace.openTextDocument(target).then(
        (doc) => vscode.window.showTextDocument(doc),
        (err) => vscode.window.showErrorMessage(`Could not open ${target}: ${err.message}`),
      );
    }
  });
}

function log(msg: string) {
  out.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}
