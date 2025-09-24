import type {
  NetflixVideoPlayer,
  NetflixVideoPlayerManager,
  NetflixWindow
} from './netflix-types';

const PLAYER_POLL_INTERVAL_MS = 200;
const PLAYER_MAX_WAIT_MS = 5000;

function getPlayerManager(): NetflixVideoPlayerManager | undefined {
  const netflixWindow = window as NetflixWindow;
  return netflixWindow.netflix?.appContext?.state?.playerApp?.getAPI().videoPlayer;
}

export async function waitForNetflixVideoPlayer(): Promise<NetflixVideoPlayer | null> {
  const start = Date.now();

  return new Promise((resolve) => {
    const attempt = () => {
      const manager = getPlayerManager();
      const sessionId = manager?.getAllPlayerSessionIds()[0];
      if (manager && sessionId) {
        const player = manager.getVideoPlayerBySessionId(sessionId);
        if (player) {
          resolve(player);
          return;
        }
      }

      if (Date.now() - start >= PLAYER_MAX_WAIT_MS) {
        resolve(null);
        return;
      }

      window.setTimeout(attempt, PLAYER_POLL_INTERVAL_MS);
    };

    attempt();
  });
}
