import path from 'node:path';

export function mediaDirectory(directory, appRoot, cwd = process.cwd()) {
  // Hostinger switches hbuilds/versions on every deployment. Keep recordings
  // outside that release tree, while respecting explicitly configured paths.
  const hostinger = appRoot.match(/^(\/home\/[^/]+\/domains\/[^/]+)\/hbuilds\//);
  const base = hostinger ? path.join(hostinger[1], 'storage') : cwd;
  return path.resolve(base, directory || './data/media');
}
