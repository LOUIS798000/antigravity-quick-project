#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PATCH_VERSION = 6;
const INITIAL_SCRIPT_MTIME = (() => {
  try {
    return fs.statSync(__filename).mtimeMs;
  } catch {
    return 0;
  }
})();

const overlayTemplate = String.raw`
(() => {
  // 仅注入 Antigravity 本地主窗口，跳过外部网页与非本地页面
  try {
    const proto = location.protocol;
    const host = location.hostname;
    if (
      (proto !== 'http:' && proto !== 'https:') ||
      (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]')
    ) {
      return;
    }
  } catch {
    return;
  }

  const CURRENT_PATCH_SIGNATURE = __PATCH_SIGNATURE__;
  if (window.__antigravityQuickProjectPatchInstalled === CURRENT_PATCH_SIGNATURE) return;
  if (typeof window.__antigravityQuickProjectCleanup === 'function') {
    try { window.__antigravityQuickProjectCleanup(); } catch {}
  }
  window.__antigravityQuickProjectPatchInstalled = CURRENT_PATCH_SIGNATURE;

  // React 协调安全防护锁（幂等安装，防止外部 DOM 变动触发 removeChild/insertBefore 异常）
  if (typeof Node === 'function' && Node.prototype && !window.__antigravityReactCrashGuardInstalled) {
    window.__antigravityReactCrashGuardInstalled = true;
    const origRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
      if (child && child.parentNode !== this) {
        return child;
      }
      return origRemoveChild.apply(this, arguments);
    };
    const origInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (newNode, refNode) {
      if (refNode && refNode.parentNode !== this) {
        return newNode;
      }
      return origInsertBefore.apply(this, arguments);
    };
  }

  const STYLE_ID = 'agy-quick-project-style';
  const TOOLTIP_ID = 'agy-quick-project-tooltip';
  const TOAST_ID = 'agy-quick-project-toast';
  const BTN_ATTR = 'data-agy-quick-project-btn';

  let tooltipEl = null;
  let toastEl = null;
  let toastTimer = null;
  let observer = null;
  let bootDomReadyHandler = null;
  let booted = false;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const hostEl = document.head || document.documentElement;
    if (!hostEl) return;
    const styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = [
      '@keyframes agy-qp-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
      '[' + BTN_ATTR + '][data-loading="1"] svg { animation: agy-qp-spin 0.8s linear infinite; }',
      '#' + TOOLTIP_ID + ' {',
      '  position: fixed; z-index: 2147483640; pointer-events: none;',
      '  padding: 5px 9px; border-radius: 8px; font-size: 12px; line-height: 1.35;',
      '  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;',
      '  background: var(--card, #ffffff); color: var(--foreground, #18181b);',
      '  border: 1px solid var(--border, rgba(0, 0, 0, 0.1));',
      '  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);',
      '  backdrop-filter: blur(12px);',
      '  opacity: 0; transform: translateY(2px); transition: opacity 120ms ease, transform 120ms ease;',
      '  white-space: nowrap;',
      '}',
      '#' + TOOLTIP_ID + '[data-visible="1"] { opacity: 1; transform: translateY(0); }',
      '#' + TOOLTIP_ID + ' .agy-qp-sub { color: var(--muted-foreground, #71717a); font-size: 11px; margin-left: 5px; }',
      '#' + TOAST_ID + ' {',
      '  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(8px);',
      '  z-index: 2147483641; pointer-events: none;',
      '  padding: 7px 14px; border-radius: 10px; font-size: 12.5px; font-weight: 500;',
      '  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;',
      '  background: var(--card, #ffffff); color: var(--foreground, #18181b);',
      '  border: 1px solid var(--border, rgba(0, 0, 0, 0.1));',
      '  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);',
      '  backdrop-filter: blur(12px);',
      '  opacity: 0; transition: opacity 160ms ease, transform 160ms ease;',
      '  display: inline-flex; align-items: center; gap: 6px;',
      '}',
      '#' + TOAST_ID + '[data-visible="1"] { opacity: 1; transform: translateX(-50%) translateY(0); }'
    ].join('\n');
    hostEl.appendChild(styleEl);
  }

  function ensureOverlays() {
    if (!document.body) return;
    if (!tooltipEl || !tooltipEl.isConnected) {
      tooltipEl = document.getElementById(TOOLTIP_ID);
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = TOOLTIP_ID;
        tooltipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipEl);
      }
    }
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.getElementById(TOAST_ID);
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = TOAST_ID;
        document.body.appendChild(toastEl);
      }
    }
  }

  function showToast(text, durationMs = 2200) {
    ensureOverlays();
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.setAttribute('data-visible', '1');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.removeAttribute('data-visible');
    }, durationMs);
  }

  function showTooltip(anchor, title, shortcut) {
    ensureOverlays();
    if (!tooltipEl || !anchor) return;
    tooltipEl.textContent = '';
    const mainSpan = document.createElement('span');
    mainSpan.textContent = title;
    tooltipEl.appendChild(mainSpan);
    if (shortcut) {
      const subSpan = document.createElement('span');
      subSpan.className = 'agy-qp-sub';
      subSpan.textContent = shortcut;
      tooltipEl.appendChild(subSpan);
    }
    tooltipEl.setAttribute('data-visible', '1');
    const rect = anchor.getBoundingClientRect();
    const tipRect = tooltipEl.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
    let top = rect.top - tipRect.height - 6;
    if (top < 8) top = rect.bottom + 6;
    tooltipEl.style.left = Math.round(left) + 'px';
    tooltipEl.style.top = Math.round(top) + 'px';
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.removeAttribute('data-visible');
  }

  // 从 React Fiber 链中动态查找 Antigravity 原生快速项目创建回调
  // 不依赖混淆后的函数名，直接通过源码特征定位，具备跨版本抗升级能力
  let cachedScratchHandler = null;

  function findFiberCallback(el, predicate) {
    if (!el) return null;
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;
    let cur = el[fiberKey];
    for (let depth = 0; depth < 64 && cur; depth++) {
      let st = cur.memoizedState;
      let idx = 0;
      while (st && idx < 300) {
        const val = st.memoizedState;
        if (Array.isArray(val) && typeof val[0] === 'function') {
          try {
            const src = Function.prototype.toString.call(val[0]);
            if (predicate(src)) {
              return val[0];
            }
          } catch {}
        }
        st = st.next;
        idx++;
      }
      cur = cur.return;
    }
    return null;
  }

  function findScratchHandlerFromElement(el) {
    return findFiberCallback(el, (src) => src.includes('createScratchProjectFolder'));
  }

  function findPickerScratchHandler(listEl) {
    const triggerEl = document.querySelector('[data-testid="project-selector-trigger"]');
    const sources = [triggerEl, listEl].filter(Boolean);
    for (const el of sources) {
      const wrapped = findFiberCallback(
        el,
        (src) => src.includes('scratch_project_button') || src.includes('PROJECT_SELECT_SCRATCH')
      );
      if (wrapped) return wrapped;
    }
    for (const el of sources) {
      const raw = findScratchHandlerFromElement(el);
      if (raw) return raw;
    }
    return null;
  }

  function resolveScratchHandler(preferredEl) {
    if (preferredEl) {
      const fromPreferred = findScratchHandlerFromElement(preferredEl);
      if (fromPreferred) {
        cachedScratchHandler = fromPreferred;
        return fromPreferred;
      }
    }
    const triggerEl = document.querySelector('[data-testid="project-selector-trigger"]');
    const fromTrigger = findScratchHandlerFromElement(triggerEl);
    if (fromTrigger) {
      cachedScratchHandler = fromTrigger;
      return fromTrigger;
    }
    const addBtn = document.querySelector('[data-testid="sidebar-add-project-button"]');
    const live = findScratchHandlerFromElement(addBtn);
    if (live) {
      cachedScratchHandler = live;
      return live;
    }
    return cachedScratchHandler;
  }

  function closeOpenPopover() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    } catch {}
  }

  let isCreating = false;
  async function triggerQuickProject(btnEl, options = {}) {
    if (isCreating) return;
    const { pickerListEl = null } = options;
    const pickerHandler = pickerListEl ? findPickerScratchHandler(pickerListEl) : null;
    const handler = pickerHandler || resolveScratchHandler(pickerListEl);
    if (typeof handler !== 'function') {
      showToast('未检测到快速新建项目入口，请先展开左侧边栏');
      return;
    }
    isCreating = true;
    hideTooltip();
    if (btnEl) {
      btnEl.setAttribute('data-loading', '1');
      if ('disabled' in btnEl) btnEl.disabled = true;
    }
    try {
      // 项目选择器触发时主动关闭下拉菜单，避免底层回调不关弹层导致浮层残留
      if (pickerListEl) {
        closeOpenPopover();
      }
      const ret = handler();
      if (ret && typeof ret.then === 'function') {
        await ret;
      } else {
        await new Promise((r) => setTimeout(r, 400));
      }
      showToast('已自动创建快速项目');
    } catch (err) {
      console.error('[Antigravity Quick Project]', err);
      showToast('快速创建项目失败：' + (err?.message || String(err)), 3200);
    } finally {
      isCreating = false;
      if (btnEl) {
        btnEl.removeAttribute('data-loading');
        if ('disabled' in btnEl) btnEl.disabled = false;
      }
    }
  }

  // 暴露给调试或外部触发
  window.__antigravityTriggerQuickProject = () => triggerQuickProject(
    document.querySelector('[' + BTN_ATTR + '="sidebar"]')
  );

  function createBoltSvg(size = 15, extraClass = '', strokeWidth = '1.85') {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('xmlns', svgNS);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(strokeWidth));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (extraClass) svg.setAttribute('class', extraClass);
    const pathEl = document.createElementNS(svgNS, 'path');
    pathEl.setAttribute('d', 'M13 2L4.5 13.5h6L9.5 22 19.5 10.5h-6L13 2z');
    svg.appendChild(pathEl);
    return svg;
  }

  function buildPickerQuickItem(referenceItem, listEl) {
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.setAttribute(BTN_ATTR, 'picker');
    item.setAttribute('aria-label', '快速新建项目');
    // 复用同组原生菜单项的样式，并补齐 hover 高亮，确保深浅主题与原生选项完全一致
    const baseClass = referenceItem && typeof referenceItem.className === 'string' && referenceItem.className.trim()
      ? referenceItem.className
      : 'agy-overlay-item group w-full pr-2 pl-1.5 text-left text-compact cursor-pointer outline-none no-focus-ring transition-colors select-none flex items-center rounded-md py-1 gap-1.5 text-secondary-foreground';
    item.className = baseClass + ' hover:bg-secondary hover:text-foreground focus:bg-secondary focus:text-foreground';

    item.appendChild(createBoltSvg(16, 'text-secondary-foreground shrink-0', '1.65'));

    const wrap = document.createElement('span');
    wrap.className = 'flex items-center gap-1.5 flex-1 min-w-0';
    const label = document.createElement('span');
    label.className = 'truncate min-w-0';
    label.title = '自动在 playground 创建随机名称项目并打开 (Alt+Shift+N)';
    label.textContent = '快速新建项目';
    wrap.appendChild(label);
    item.appendChild(wrap);

    const activate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerQuickProject(item, { pickerListEl: listEl });
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') activate(e);
    });
    return item;
  }

  function ensurePickerInjected() {
    const listEl = document.querySelector('[data-testid="project-selector-list"]');
    if (!listEl) return;
    // 「新建项目」与「无项目」固定在底部，是 project-selector-list 的同级节点（同属 .agy-overlay 弹层容器）
    const popupEl = listEl.closest('.agy-overlay') || listEl.parentElement;
    if (!popupEl) return;
    if (popupEl.querySelector('[' + BTN_ATTR + '="picker"]')) return;

    const items = Array.from(popupEl.querySelectorAll('.agy-overlay-item, [role="menuitem"], [role="option"]'));
    if (items.length === 0) return;

    const matchExactText = (el, re) => {
      if (re.test((el.textContent || '').trim())) return true;
      const spans = el.querySelectorAll('span');
      for (const s of spans) {
        if (re.test((s.textContent || '').trim())) return true;
      }
      return false;
    };

    // 1. 优先定位「新建项目 / New Project / Create Project / Add Project」菜单项
    const newProjectRe = /^(新建项目|创建新项目|创建项目|New Project|Create Project|Create New Project|Add Project|Open Folder)$/i;
    let targetItem = items.find((el) => matchExactText(el, newProjectRe));

    // 2. 兜底：通过「无项目 / No Project」向上寻找前一个分组的最后一项
    if (!targetItem) {
      const noProjectRe = /^(无项目|No Project)$/i;
      const noProjItem = items.find((el) => matchExactText(el, noProjectRe));
      if (noProjItem && noProjItem.parentElement) {
        let prev = noProjItem.parentElement.previousElementSibling;
        while (prev && !prev.querySelector('.agy-overlay-item, [role="menuitem"], [role="option"]')) {
          prev = prev.previousElementSibling;
        }
        if (prev && prev !== listEl) {
          const prevItems = prev.querySelectorAll('.agy-overlay-item, [role="menuitem"], [role="option"]');
          if (prevItems.length > 0) targetItem = prevItems[prevItems.length - 1];
        }
      }
    }

    // 3. 终极结构兜底：在 project-selector-list 之后的第一个含 menuitem 的分组
    if (!targetItem) {
      let next = listEl.nextElementSibling;
      while (next) {
        const nextItems = next.querySelectorAll('.agy-overlay-item, [role="menuitem"], [role="option"]');
        if (nextItems.length > 0) {
          targetItem = nextItems[nextItems.length - 1];
          break;
        }
        next = next.nextElementSibling;
      }
    }

    if (!targetItem || !targetItem.parentElement) return;
    const quickItem = buildPickerQuickItem(targetItem, listEl);
    targetItem.parentElement.appendChild(quickItem);
  }

  function buildSidebarQuickButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(BTN_ATTR, 'sidebar');
    btn.setAttribute('aria-label', '快速新建项目');
    btn.setAttribute('data-no-drag', '');
    btn.className = [
      'agy-button',
      'agy-button-icon-sm',
      'inline-flex',
      'items-center',
      'font-medium',
      'transition-colors',
      'select-none',
      'outline-none',
      'cursor-pointer',
      'justify-center',
      'disabled:opacity-50',
      'bg-transparent',
      'text-muted-foreground',
      'hover:text-foreground',
      'hover:bg-secondary',
      'focus-visible:text-foreground',
      'focus-visible:bg-secondary',
      'h-5',
      'w-5',
      'shrink-0',
      'flex',
      'items-center',
      'justify-center',
      'rounded-md',
      'hover:bg-sidebar-secondary'
    ].join(' ');

    btn.appendChild(createBoltSvg(15, '', '1.85'));

    btn.addEventListener('mouseenter', () => {
      showTooltip(btn, '快速新建项目', 'Alt+Shift+N');
    });
    btn.addEventListener('mouseleave', hideTooltip);
    btn.addEventListener('focus', () => {
      showTooltip(btn, '快速新建项目', 'Alt+Shift+N');
    });
    btn.addEventListener('blur', hideTooltip);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerQuickProject(btn);
    });
    return btn;
  }

  function ensureInjected() {
    ensureStyle();
    const addBtn = document.querySelector('[data-testid="sidebar-add-project-button"]');
    if (addBtn && addBtn.parentElement) {
      // 提前缓存原生回调，确保即使侧边栏折叠后快捷键依然可用
      resolveScratchHandler();
      const parent = addBtn.parentElement;
      if (!parent.querySelector('[' + BTN_ATTR + '="sidebar"]')) {
        const quickBtn = buildSidebarQuickButton();
        // 追加在容器末尾，对 React 同级子节点 diff 最友好
        parent.appendChild(quickBtn);
      }
    }
    // 同步检测新建对话的「选择项目」下拉菜单，在「新建项目」下方自动插入「快速新建项目」
    ensurePickerInjected();
  }

  // 全局快捷键：Alt + Shift + N 一键快速新建项目
  function onKeyDown(e) {
    if (e.isComposing) return;
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyN' || e.key === 'N' || e.key === 'n')) {
      e.preventDefault();
      e.stopPropagation();
      triggerQuickProject(document.querySelector('[' + BTN_ATTR + '="sidebar"]'));
    }
  }
  window.addEventListener('keydown', onKeyDown, true);

  // 节流 MutationObserver：仅当 DOM 子树更新时自动补回按钮，空闲零开销
  let rafPending = false;
  function scheduleCheck() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      ensureInjected();
    });
  }

  function boot() {
    if (booted || !document.body) return;
    booted = true;
    ensureStyle();
    ensureOverlays();
    observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, { childList: true, subtree: true });
    ensureInjected();
  }

  if (document.body) {
    boot();
  } else {
    bootDomReadyHandler = () => boot();
    document.addEventListener('DOMContentLoaded', bootDomReadyHandler, { once: true });
    window.addEventListener('load', bootDomReadyHandler, { once: true });
  }

  // 完整清理钩子（用于热重载或卸载）
  window.__antigravityQuickProjectCleanup = () => {
    try { if (observer) observer.disconnect(); } catch {}
    try { window.removeEventListener('keydown', onKeyDown, true); } catch {}
    if (bootDomReadyHandler) {
      try { document.removeEventListener('DOMContentLoaded', bootDomReadyHandler); } catch {}
      try { window.removeEventListener('load', bootDomReadyHandler); } catch {}
    }
    if (toastTimer) clearTimeout(toastTimer);
    try {
      document.querySelectorAll('[' + BTN_ATTR + ']').forEach((el) => el.remove());
      const st = document.getElementById(STYLE_ID);
      if (st) st.remove();
      const tip = document.getElementById(TOOLTIP_ID);
      if (tip) tip.remove();
      const tst = document.getElementById(TOAST_ID);
      if (tst) tst.remove();
    } catch {}
    delete window.__antigravityTriggerQuickProject;
  };
})();
`;

const PATCH_SIGNATURE = `v${PATCH_VERSION}-${crypto.createHash('sha1').update(overlayTemplate).digest('hex').slice(0, 8)}`;
const overlaySource = overlayTemplate.replace('__PATCH_SIGNATURE__', JSON.stringify(PATCH_SIGNATURE));

function readActivePortInfo() {
  const candidates = [];
  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort'));
    }
    candidates.push(path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));
  } else {
    candidates.push(path.join(os.homedir(), '.config', 'Antigravity', 'DevToolsActivePort'));
  }

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/);
        const firstLine = (lines[0] || '').trim();
        const secondLine = (lines[1] || '').trim();
        const port = Number(firstLine);
        if (Number.isInteger(port) && port > 0 && port < 65536) {
          return {
            port,
            wsPath: secondLine.startsWith('/') ? secondLine : ''
          };
        }
      }
    } catch {}
  }
  return null;
}

async function isValidCdpPort(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && typeof data === 'object' && (data.webSocketDebuggerUrl || data['Protocol-Version']));
  } catch {
    return false;
  }
}

function antigravityPids() {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
      const pids = [];
      for (const line of output.split('\n')) {
        const match = line.match(/"Antigravity\.exe","(\d+)"/i);
        if (match) pids.push(match[1]);
      }
      return pids;
    }
    const output = execFileSync('pgrep', ['-f', 'Antigravity.app/Contents/MacOS/Antigravity'], { encoding: 'utf8' });
    return output.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getListeningPortsForPids(pids) {
  if (pids.length === 0) return [];
  const pidSet = new Set(pids.map(Number));
  const ports = new Set();
  try {
    if (process.platform === 'win32') {
      const netstat = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
      for (const line of netstat.split('\n')) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5) {
            const localAddr = parts[1];
            const pid = Number(parts[parts.length - 1]);
            if (pidSet.has(pid)) {
              const lastColon = localAddr.lastIndexOf(':');
              if (lastColon !== -1) {
                const port = Number(localAddr.slice(lastColon + 1));
                if (Number.isInteger(port) && port > 0) ports.add(port);
              }
            }
          }
        }
      }
    } else {
      const lsof = execFileSync('lsof', ['-Pan', '-iTCP', '-sTCP:LISTEN', '-p', pids.join(',')], { encoding: 'utf8' });
      for (const line of lsof.split('\n')) {
        const match = line.match(/:(\d+)\s+\(LISTEN\)/);
        if (match) {
          const port = Number(match[1]);
          if (Number.isInteger(port) && port > 0) ports.add(port);
        }
      }
    }
  } catch {}
  return [...ports];
}

let cachedPorts = [];
let lastPortScanTime = 0;

async function getValidDebugPorts() {
  const activeInfo = readActivePortInfo();
  const activeFilePort = activeInfo ? activeInfo.port : null;
  if (activeFilePort && await isValidCdpPort(activeFilePort)) {
    cachedPorts = [activeFilePort];
    return cachedPorts;
  }

  const stillValidPorts = [];
  for (const port of cachedPorts) {
    if (await isValidCdpPort(port)) stillValidPorts.push(port);
  }
  if (stillValidPorts.length > 0) {
    cachedPorts = stillValidPorts;
    return cachedPorts;
  }

  const now = Date.now();
  if (now - lastPortScanTime > 12000) {
    lastPortScanTime = now;
    const currentPids = antigravityPids();
    if (currentPids.length === 0) {
      cachedPorts = [];
      return [];
    }
    const candidatePorts = getListeningPortsForPids(currentPids);
    const verifiedPorts = [];
    for (const port of candidatePorts) {
      if (await isValidCdpPort(port)) verifiedPorts.push(port);
    }
    cachedPorts = verifiedPorts;
  }

  return cachedPorts;
}

// 仅注入 Antigravity 主界面 page（忽略 sidecar iframe / webview / 外部网站）
function isInjectableTarget(target) {
  if (!target || target.type !== 'page') return false;
  const url = String(target.url || '');
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

async function targetsForPort(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return [];
    const targets = await response.json();
    if (!Array.isArray(targets)) return [];
    return targets.filter((target) => isInjectableTarget(target) && target.webSocketDebuggerUrl);
  } catch {
    return [];
  }
}

function cdpCall(ws, method, params = {}, sessionId = undefined) {
  const id = cdpCall.nextId = (cdpCall.nextId || 0) + 1;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${method} timed out`));
    }, 2000);

    function onMessage(event) {
      try {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        cleanup();
        resolve(message);
      } catch (err) {
        cleanup();
        reject(err);
      }
    }
    function onError(err) { cleanup(); reject(err); }
    function onClose() { cleanup(); reject(new Error('WebSocket closed unexpectedly')); }
    function cleanup() {
      clearTimeout(timeout);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
    }

    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);

    try {
      const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
      ws.send(JSON.stringify(payload));
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

const injectedTargetState = new Map();
const TARGET_REVERIFY_INTERVAL_MS = 60000;

function isTargetRecentlyVerified(targetId, url, now) {
  if (!targetId) return false;
  const state = injectedTargetState.get(targetId);
  if (!state) return false;
  return state.signature === PATCH_SIGNATURE && state.url === url && (now - state.verifiedAt) < TARGET_REVERIFY_INTERVAL_MS;
}

function pruneStaleTargets(activeIds) {
  for (const key of injectedTargetState.keys()) {
    if (!activeIds.has(key)) injectedTargetState.delete(key);
  }
}

// 兼容 Node.js 18 / 20 LTS（无全局 WebSocket 时自动回退到原生 RFC 6455 实现）
class MinimalWebSocket {
  constructor(url) {
    this._listeners = { open: new Set(), message: new Set(), error: new Set(), close: new Set() };
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._socket = null;
    this._closed = false;

    const parsed = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });
    this._req = req;
    req.on('error', (err) => this._emit('error', err));
    req.on('response', (res) => {
      res.resume();
      this._emit('error', new Error(`Unexpected HTTP status ${res.statusCode}`));
    });
    req.on('upgrade', (_res, socket, head) => {
      this._req = null;
      if (this._closed) {
        try { socket.destroy(); } catch {}
        return;
      }
      socket.setNoDelay(true);
      this._socket = socket;

      let rxBuf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      let fragChunks = [];
      let fragOpcode = 0;

      const parseFrames = () => {
        while (rxBuf.length >= 2) {
          const b0 = rxBuf[0];
          const b1 = rxBuf[1];
          const fin = (b0 & 0x80) !== 0;
          const opcode = b0 & 0x0f;
          const masked = (b1 & 0x80) !== 0;
          let len = b1 & 0x7f;
          let offset = 2;
          if (len === 126) {
            if (rxBuf.length < 4) break;
            len = rxBuf.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (rxBuf.length < 10) break;
            len = rxBuf.readUInt32BE(2) * 4294967296 + rxBuf.readUInt32BE(6);
            offset = 10;
          }
          const totalLen = offset + (masked ? 4 : 0) + len;
          if (rxBuf.length < totalLen) break;

          let payload = Buffer.from(rxBuf.subarray(offset + (masked ? 4 : 0), totalLen));
          if (masked) {
            const mask = rxBuf.subarray(offset, offset + 4);
            for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
          }
          rxBuf = rxBuf.subarray(totalLen);

          if (opcode === 0x8) {
            this._closed = true;
            try { socket.end(); } catch {}
            this._emit('close', {});
            return;
          }
          if (opcode === 0x9) {
            this._sendFrame(0x8a, payload);
            continue;
          }
          if (opcode === 0x0a) continue;

          if (opcode !== 0x0) {
            fragOpcode = opcode;
            fragChunks = [payload];
          } else {
            fragChunks.push(payload);
          }
          if (fin) {
            const full = fragChunks.length === 1 ? fragChunks[0] : Buffer.concat(fragChunks);
            fragChunks = [];
            if (fragOpcode === 0x1) {
              this._emit('message', { data: full.toString('utf8') });
            }
          }
        }
      };

      socket.on('data', (chunk) => {
        rxBuf = rxBuf.length === 0 ? chunk : Buffer.concat([rxBuf, chunk]);
        parseFrames();
      });
      socket.on('error', (err) => this._emit('error', err));
      socket.on('close', () => {
        this._closed = true;
        this._emit('close', {});
      });

      queueMicrotask(() => {
        if (!this._closed) {
          this._emit('open', {});
          if (rxBuf.length > 0) parseFrames();
        }
      });
    });
    req.end();
  }

  addEventListener(type, fn) { if (this._listeners[type]) this._listeners[type].add(fn); }
  removeEventListener(type, fn) { if (this._listeners[type]) this._listeners[type].delete(fn); }

  _emit(type, event) {
    const handler = this[`on${type}`];
    if (typeof handler === 'function') { try { handler(event); } catch {} }
    const set = this._listeners[type];
    if (set) {
      for (const fn of [...set]) { try { fn(event); } catch {} }
    }
  }

  _sendFrame(firstByte, payloadBuf) {
    if (!this._socket || this._closed) return;
    const len = payloadBuf.length;
    const mask = crypto.randomBytes(4);
    let headerLen = 2;
    if (len >= 65536) headerLen = 10;
    else if (len >= 126) headerLen = 4;

    const frame = Buffer.allocUnsafe(headerLen + 4 + len);
    frame[0] = firstByte;
    if (len < 126) {
      frame[1] = 0x80 | len;
    } else if (len < 65536) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(len, 2);
    } else {
      frame[1] = 0x80 | 127;
      frame.writeUInt32BE(0, 2);
      frame.writeUInt32BE(len >>> 0, 6);
    }
    mask.copy(frame, headerLen);
    for (let i = 0; i < len; i++) frame[headerLen + 4 + i] = payloadBuf[i] ^ mask[i & 3];
    this._socket.write(frame);
  }

  send(data) { this._sendFrame(0x81, Buffer.from(String(data), 'utf8')); }

  close() {
    if (this._closed) return;
    this._closed = true;
    if (this._req) { try { this._req.destroy(); } catch {} this._req = null; }
    if (this._socket) {
      try {
        this._sendFrame(0x88, Buffer.alloc(0));
        this._socket.end();
      } catch {
        try { this._socket.destroy(); } catch {}
      }
    }
  }
}

const WebSocketImpl = typeof WebSocket === 'function' ? WebSocket : MinimalWebSocket;

async function openWebSocket(url) {
  const ws = new WebSocketImpl(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('websocket timed out'));
    }, 1500);
    ws.onopen = () => { clearTimeout(timeout); resolve(); };
    ws.onerror = (e) => { clearTimeout(timeout); reject(e); };
  });
  return ws;
}

async function injectTarget(target) {
  const targetId = target.id;
  const targetUrl = String(target.url || '');
  const now = Date.now();
  if (isTargetRecentlyVerified(targetId, targetUrl, now)) return false;

  const ws = await openWebSocket(target.webSocketDebuggerUrl);
  try {
    const prevState = targetId ? injectedTargetState.get(targetId) : null;
    const checkRes = await cdpCall(ws, 'Runtime.evaluate', {
      expression: 'window.__antigravityQuickProjectPatchInstalled',
      returnByValue: true
    }).catch(() => null);

    if (checkRes?.result?.result?.value === PATCH_SIGNATURE) {
      if (targetId) {
        injectedTargetState.set(targetId, {
          url: targetUrl,
          signature: PATCH_SIGNATURE,
          verifiedAt: now,
          scriptId: prevState?.scriptId || null
        });
      }
      return false;
    }

    if (prevState?.scriptId) {
      await cdpCall(ws, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: prevState.scriptId }).catch(() => null);
    }
    const addRes = await cdpCall(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: overlaySource }).catch(() => null);
    const scriptId = addRes?.result?.identifier || null;
    await cdpCall(ws, 'Runtime.evaluate', { expression: overlaySource, awaitPromise: false });

    if (targetId) {
      injectedTargetState.set(targetId, {
        url: targetUrl,
        signature: PATCH_SIGNATURE,
        verifiedAt: now,
        scriptId
      });
    }
    return true;
  } finally {
    try { ws.close(); } catch {}
  }
}

async function injectViaBrowserWebSocket(port, wsPath, activeIds) {
  if (!port || !wsPath) return { injectedCount: 0, connected: false };
  let ws;
  try {
    ws = await openWebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  } catch {
    return { injectedCount: 0, connected: false };
  }

  let injectedCount = 0;
  const now = Date.now();
  try {
    const targetsRes = await cdpCall(ws, 'Target.getTargets').catch(() => null);
    const targetInfos = targetsRes?.result?.targetInfos;
    if (!Array.isArray(targetInfos)) return { injectedCount: 0, connected: true };

    for (const info of targetInfos) {
      if (!isInjectableTarget(info) || !info.targetId) continue;
      activeIds.add(info.targetId);
      const targetUrl = String(info.url || '');
      if (isTargetRecentlyVerified(info.targetId, targetUrl, now)) continue;

      let sessionId = null;
      try {
        const prevState = injectedTargetState.get(info.targetId);
        const attachRes = await cdpCall(ws, 'Target.attachToTarget', {
          targetId: info.targetId,
          flatten: true
        });
        sessionId = attachRes?.result?.sessionId;
        if (!sessionId) continue;

        const checkRes = await cdpCall(ws, 'Runtime.evaluate', {
          expression: 'window.__antigravityQuickProjectPatchInstalled',
          returnByValue: true
        }, sessionId).catch(() => null);

        if (checkRes?.result?.result?.value === PATCH_SIGNATURE) {
          injectedTargetState.set(info.targetId, {
            url: targetUrl,
            signature: PATCH_SIGNATURE,
            verifiedAt: now,
            scriptId: prevState?.scriptId || null
          });
          continue;
        }

        if (prevState?.scriptId) {
          await cdpCall(ws, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: prevState.scriptId }, sessionId).catch(() => null);
        }
        const addRes = await cdpCall(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: overlaySource }, sessionId).catch(() => null);
        const scriptId = addRes?.result?.identifier || null;
        await cdpCall(ws, 'Runtime.evaluate', { expression: overlaySource, awaitPromise: false }, sessionId);

        injectedTargetState.set(info.targetId, {
          url: targetUrl,
          signature: PATCH_SIGNATURE,
          verifiedAt: now,
          scriptId
        });
        injectedCount += 1;
      } catch {} finally {
        if (sessionId) {
          await cdpCall(ws, 'Target.detachFromTarget', { sessionId }).catch(() => null);
        }
      }
    }
  } finally {
    try { ws.close(); } catch {}
  }
  return { injectedCount, connected: true };
}

async function injectOnce() {
  let count = 0;
  let foundAnyHttpTargets = false;
  const activeIds = new Set();
  const ports = await getValidDebugPorts();
  for (const port of ports) {
    const targets = await targetsForPort(port);
    if (targets.length > 0) foundAnyHttpTargets = true;
    for (const target of targets) {
      if (target.id) activeIds.add(target.id);
      try {
        const injected = await injectTarget(target);
        if (injected) count += 1;
      } catch {}
    }
  }

  let hasActivePort = ports.length > 0;
  if (!foundAnyHttpTargets) {
    const activeInfo = readActivePortInfo();
    if (activeInfo && activeInfo.port && activeInfo.wsPath) {
      const fallbackRes = await injectViaBrowserWebSocket(activeInfo.port, activeInfo.wsPath, activeIds);
      if (fallbackRes.connected) hasActivePort = true;
      count += fallbackRes.injectedCount;
    }
  }

  pruneStaleTargets(activeIds);
  return { count, hasActivePort };
}

function exitIfScriptModified() {
  if (!INITIAL_SCRIPT_MTIME) return;
  try {
    const currentMtime = fs.statSync(__filename).mtimeMs;
    if (currentMtime && currentMtime !== INITIAL_SCRIPT_MTIME) {
      process.exit(0);
    }
  } catch {}
}

async function watch() {
  for (;;) {
    exitIfScriptModified();
    let hasActivePort = false;
    try {
      const res = await injectOnce();
      hasActivePort = res.hasActivePort;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, hasActivePort ? 5000 : 8000));
  }
}

if (process.argv.includes('--watch')) {
  watch();
} else {
  injectOnce().then(({ count }) => {
    console.log(`已向 ${count} 个 Antigravity 主窗口注入快速新建项目补丁 (v${PATCH_VERSION})。`);
  });
}
