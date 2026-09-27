const DEFAULT_UPDATE_URL = '';

function normalizeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function getUpdateConfig() {
  const url = normalizeUrl(process.env.VIDEO_HUB_UPDATE_URL || DEFAULT_UPDATE_URL);
  return {
    provider: 'generic',
    url,
    channel: 'stable',
    configured: Boolean(url),
  };
}

module.exports = { getUpdateConfig };
