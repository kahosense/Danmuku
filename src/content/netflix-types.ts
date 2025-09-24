export interface NetflixPlayerApp {
  getAPI(): NetflixPlayerAPI;
}

export interface NetflixPlayerAPI {
  videoPlayer: NetflixVideoPlayerManager;
}

export interface NetflixVideoPlayerManager {
  getAllPlayerSessionIds(): string[];
  getVideoPlayerBySessionId(sessionId: string): NetflixVideoPlayer | undefined;
}

export interface NetflixVideoPlayer {
  on(event: 'timedTextCueEntered', handler: (cue: NetflixTimedTextCue) => void): void;
  off(event: 'timedTextCueEntered', handler: (cue: NetflixTimedTextCue) => void): void;
  getVideoData?(): NetflixVideoData | undefined;
  getCurrentTime?(): number;
}

export interface NetflixTimedTextCue {
  id?: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface NetflixVideoData {
  movieId?: number | string;
  title?: string;
  type?: string;
}

export interface NetflixWindow extends Window {
  netflix?: {
    appContext?: {
      state?: {
        playerApp?: NetflixPlayerApp;
      };
    };
  };
}
