/**
 * CPA 仓管路由
 * 扫描 CLIProxyAPI auth-files 里的 401 凭证，并自动重登换货。
 */

const router = require('express').Router();
const warehouseService = require('../services/cpa-warehouse-service');

function getOptions(req) {
  return {
    baseUrl: req.body?.baseUrl || req.query?.baseUrl,
    managementKey: req.body?.managementKey || req.query?.managementKey,
    maxItems: req.body?.maxItems || req.query?.maxItems,
  };
}

function requireManagementKey(options, res) {
  if (!String(options.managementKey || '').trim()) {
    res.status(400).json({ success: false, error: '缺少 CPA 管理密钥' });
    return false;
  }
  return true;
}

/**
 * POST /api/warehouse/cpa/scan-401 - 扫描 CPA 401 凭证
 */
router.post('/warehouse/cpa/scan-401', async (req, res) => {
  try {
    const options = getOptions(req);
    if (!requireManagementKey(options, res)) return;

    const result = await warehouseService.scan401Credentials(options);
    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/warehouse/cpa/repair-401 - 401 凭证重登，成功上传，封号删除
 */
router.post('/warehouse/cpa/repair-401', async (req, res) => {
  try {
    const options = getOptions(req);
    if (!requireManagementKey(options, res)) return;

    const broadcast = req.app.get('broadcast');
    const result = await warehouseService.repair401Credentials(options, event => {
      if (broadcast) broadcast(event);
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

module.exports = router;
