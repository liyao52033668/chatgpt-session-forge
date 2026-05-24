/**
 * CPA 仓管前端
 * 扫描 401 凭证，并触发后端自动重登换货。
 */

let _warehouseRows = [];
let _warehouseAutoTimer = null;
let _warehouseBusy = false;
const CPA_WAREHOUSE_SETTINGS_KEY = 'cpaWarehouseSettings';
const WAREHOUSE_LOGGABLE_LOGIN_STATUSES = new Set([
  'login_start',
  'identifier',
  'password',
  'waiting_code',
  'verify_code',
  'session',
]);

function getCpaWarehousePayload() {
  return {
    baseUrl: document.getElementById('cpaBaseUrl').value.trim(),
    managementKey: document.getElementById('cpaManagementKey').value.trim(),
    maxItems: parseInt(document.getElementById('cpaMaxItems').value, 10) || 20,
  };
}

function loadCpaWarehouseSettings() {
  let settings = {};
  try {
    settings = JSON.parse(localStorage.getItem(CPA_WAREHOUSE_SETTINGS_KEY) || '{}');
  } catch {
    settings = {};
  }

  if (settings.baseUrl) document.getElementById('cpaBaseUrl').value = settings.baseUrl;
  if (settings.managementKey) document.getElementById('cpaManagementKey').value = settings.managementKey;
  if (settings.maxItems) document.getElementById('cpaMaxItems').value = settings.maxItems;
  if (settings.autoInterval) document.getElementById('cpaAutoInterval').value = settings.autoInterval;
  document.getElementById('cpaAutoToggle').checked = Boolean(settings.autoEnabled);
}

function saveCpaWarehouseSettings() {
  const settings = {
    baseUrl: document.getElementById('cpaBaseUrl')?.value.trim() || '',
    managementKey: document.getElementById('cpaManagementKey')?.value.trim() || '',
    maxItems: document.getElementById('cpaMaxItems')?.value || '20',
    autoEnabled: Boolean(document.getElementById('cpaAutoToggle')?.checked),
    autoInterval: document.getElementById('cpaAutoInterval')?.value || '5',
  };
  localStorage.setItem(CPA_WAREHOUSE_SETTINGS_KEY, JSON.stringify(settings));
}

function validateCpaWarehousePayload(payload) {
  if (!payload.baseUrl) {
    showToast('请填写 CPA 地址', 'warning');
    return false;
  }
  if (!payload.managementKey) {
    showToast('请填写 CPA 管理密钥', 'warning');
    return false;
  }
  return true;
}

function getCpaAutoIntervalMs() {
  const minutes = parseInt(document.getElementById('cpaAutoInterval')?.value, 10) || 5;
  return Math.max(1, Math.min(1440, minutes)) * 60 * 1000;
}

function isCpaAutoEnabled() {
  return Boolean(document.getElementById('cpaAutoToggle')?.checked);
}

function setWarehouseConnectionState(state, text) {
  const pill = document.getElementById('cpaConnectionStatus');
  const label = document.getElementById('cpaConnectionText');
  if (!pill || !label) return;
  pill.className = `warehouse-status-pill ${state || 'idle'}`;
  label.textContent = text || '未连接';
}

async function scanCpa401() {
  saveCpaWarehouseSettings();
  const payload = getCpaWarehousePayload();
  if (!validateCpaWarehousePayload(payload)) return;

  const btn = document.getElementById('btnCpaScan401');
  setButtonLoading(btn, true);
  setWarehouseConnectionState('running', '连接中');
  try {
    const res = await fetch('/api/warehouse/cpa/scan-401', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '扫描失败');

    _warehouseRows = data.candidates || [];
    renderWarehouseRows(_warehouseRows);
    updateWarehouseStats({
      total: data.total,
      candidates: _warehouseRows.length,
      uploaded: 0,
      deleted: 0,
    });
    addWarehouseLog(`扫描完成: 共 ${data.total} 个凭证，发现 ${_warehouseRows.length} 个 401`, _warehouseRows.length ? 'warning' : 'success');
    showToast(`发现 ${_warehouseRows.length} 个 401 凭证`, _warehouseRows.length ? 'warning' : 'success');
    setWarehouseConnectionState('connected', _warehouseRows.length ? `已连接 · ${_warehouseRows.length} 个 401` : '已连接');
  } catch (err) {
    showToast('扫描失败: ' + err.message, 'error');
    addWarehouseLog('扫描失败: ' + err.message, 'error');
    setWarehouseConnectionState('error', '连接失败');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function repairCpa401(options = {}) {
  saveCpaWarehouseSettings();
  const payload = getCpaWarehousePayload();
  if (!validateCpaWarehousePayload(payload)) return;
  if (_warehouseBusy) {
    if (!options.silent) showToast('CPA 仓管正在处理中', 'warning');
    return;
  }

  const btn = document.getElementById('btnCpaRepair401');
  _warehouseBusy = true;
  if (!options.silent) setButtonLoading(btn, true);
  setWarehouseConnectionState('running', options.auto ? '自动运行中' : '连接中');
  try {
    const res = await fetch('/api/warehouse/cpa/repair-401', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '修复失败');

    _warehouseRows = data.results || [];
    renderWarehouseRows(_warehouseRows);
    updateWarehouseStats(data.summary || {});
    const summary = data.summary || {};
    const failed = summary.failed || 0;
    if (!options.auto || isCpaAutoEnabled()) {
      const label = options.auto ? '自动仓管已连接' : '已连接';
      setWarehouseConnectionState('connected', failed > 0 ? `${label} · ${failed} 个失败` : label);
    }
    if (!options.silent) showToast('CPA 仓管处理完成', 'success');
  } catch (err) {
    if (!options.silent) showToast('修复失败: ' + err.message, 'error');
    addWarehouseLog('修复失败: ' + err.message, 'error');
    setWarehouseConnectionState('error', '连接失败');
  } finally {
    _warehouseBusy = false;
    if (!options.silent) setButtonLoading(btn, false);
  }
}

function stopCpaAutoWarehouse(reason = '自动仓管已关闭') {
  if (_warehouseAutoTimer) {
    clearInterval(_warehouseAutoTimer);
    _warehouseAutoTimer = null;
  }
  setWarehouseConnectionState('idle', '未连接');
  addWarehouseLog(reason, 'info');
}

function startCpaAutoWarehouse() {
  saveCpaWarehouseSettings();
  if (_warehouseAutoTimer) {
    clearInterval(_warehouseAutoTimer);
    _warehouseAutoTimer = null;
  }

  const payload = getCpaWarehousePayload();
  if (!validateCpaWarehousePayload(payload)) {
    document.getElementById('cpaAutoToggle').checked = false;
    saveCpaWarehouseSettings();
    setWarehouseConnectionState('idle', '未连接');
    return;
  }

  const intervalMs = getCpaAutoIntervalMs();
  const minutes = Math.round(intervalMs / 60000);
  setWarehouseConnectionState('running', '自动运行中');
  addWarehouseLog(`自动仓管已开启: 每 ${minutes} 分钟扫描并修复 401`, 'success');
  repairCpa401({ auto: true, silent: true });
  _warehouseAutoTimer = setInterval(() => {
    repairCpa401({ auto: true, silent: true });
  }, intervalMs);
}

function handleCpaAutoToggle() {
  saveCpaWarehouseSettings();
  const enabled = document.getElementById('cpaAutoToggle')?.checked;
  if (enabled) startCpaAutoWarehouse();
  else stopCpaAutoWarehouse();
}

function restartCpaAutoWarehouseIfNeeded() {
  saveCpaWarehouseSettings();
  const toggle = document.getElementById('cpaAutoToggle');
  if (!toggle?.checked) return;
  startCpaAutoWarehouse();
}

function renderWarehouseRows(rows) {
  const tbody = document.getElementById('warehouseTableBody');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state" style="padding:40px 20px"><p>没有需要处理的 401 凭证</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const message = row.message || row.status_message || '-';
    const action = formatWarehouseAction(row.action || row.status || '401');
    const okClass = row.ok === true ? 'warehouse-ok' : row.ok === false ? 'warehouse-bad' : '';
    return `<tr>
      <td title="${escapeAttr(row.name || '')}">${escapeHtml(row.name || '-')}</td>
      <td title="${escapeAttr(row.email || '')}">${escapeHtml(row.email || '-')}</td>
      <td>${escapeHtml(action)}</td>
      <td class="${okClass}" title="${escapeAttr(message)}">${escapeHtml(message)}</td>
    </tr>`;
  }).join('');
}

function updateWarehouseStats(summary = {}) {
  document.getElementById('cpaStatTotal').textContent = summary.total ?? 0;
  document.getElementById('cpaStat401').textContent = summary.candidates ?? summary.processed ?? 0;
  document.getElementById('cpaStatUploaded').textContent = summary.uploaded ?? 0;
  document.getElementById('cpaStatDeleted').textContent = summary.deleted ?? 0;
}

function formatWarehouseAction(action) {
  const labels = {
    uploaded: '已上传',
    deleted_deactivated: '封号删除',
    skipped: '已跳过',
    login_failed: '登录失败',
    ready: '正常',
  };
  return labels[action] || action || '-';
}

function onWarehouseEvent(data) {
  if (data.type === 'warehouse_start') {
    addWarehouseLog(`开始处理: ${data.total || 0} 个 401 凭证`, 'info');
  } else if (data.type === 'warehouse_status') {
    if (!WAREHOUSE_LOGGABLE_LOGIN_STATUSES.has(data.status)) return;
    addWarehouseLog(`${data.email || data.name || 'CPA 凭证'} ${formatLoginStatus(data.status, data.detail)}`, data.status === 'waiting_code' ? 'warning' : 'info');
  } else if (data.type === 'warehouse_item') {
    const result = data.result || {};
    addWarehouseLog(`${result.email || result.name || 'CPA 凭证'} ${result.message || result.action}`, result.ok ? 'success' : 'warning');
  } else if (data.type === 'warehouse_complete') {
    const s = data.summary || {};
    addWarehouseLog(`处理完成: 上传 ${s.uploaded || 0}，删除 ${s.deleted || 0}，失败 ${s.failed || 0}，跳过 ${s.skipped || 0}`, s.failed ? 'warning' : 'success');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadCpaWarehouseSettings();
  document.getElementById('btnCpaScan401')?.addEventListener('click', scanCpa401);
  document.getElementById('btnCpaRepair401')?.addEventListener('click', () => repairCpa401());
  document.getElementById('cpaAutoToggle')?.addEventListener('change', handleCpaAutoToggle);
  document.getElementById('cpaAutoInterval')?.addEventListener('change', restartCpaAutoWarehouseIfNeeded);
  document.getElementById('cpaBaseUrl')?.addEventListener('change', restartCpaAutoWarehouseIfNeeded);
  document.getElementById('cpaManagementKey')?.addEventListener('change', restartCpaAutoWarehouseIfNeeded);
  document.getElementById('cpaMaxItems')?.addEventListener('change', saveCpaWarehouseSettings);
  document.getElementById('cpaBaseUrl')?.addEventListener('input', saveCpaWarehouseSettings);
  document.getElementById('cpaManagementKey')?.addEventListener('input', saveCpaWarehouseSettings);
  document.getElementById('cpaMaxItems')?.addEventListener('input', saveCpaWarehouseSettings);
  document.getElementById('cpaAutoInterval')?.addEventListener('input', saveCpaWarehouseSettings);
  setWarehouseConnectionState('idle', '未连接');
  if (document.getElementById('cpaAutoToggle')?.checked) startCpaAutoWarehouse();
});
