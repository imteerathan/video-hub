const GITHUB_OWNER = 'imteerathan';
const GITHUB_REPO = 'video-hub';

function getUpdateConfig() {
  return {
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    channel: 'latest',
    displayChannel: 'stable',
    configured: true,
  };
}

module.exports = { getUpdateConfig };
