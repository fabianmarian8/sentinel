// Fetcher exports
export { fetchHttp } from './http';
export { fetchHeadless, closeBrowser } from './headless';
export { fetchFlareSolverr, isFlareSolverrAvailable } from './flaresolverr';
export { smartFetch } from './smart-fetch';
export { getRandomUserAgent, USER_AGENTS } from './user-agents';
export { detectBlock, blockTypeToErrorCode } from './block-detection';
export { isJavaScriptRequired, analyzeContentQuality } from './spa-detection';
export type { FetchResult, FetchOptions } from './types';
export type { HeadlessFetchOptions } from './headless';
export type { FlareSolverrOptions } from './flaresolverr';
export type { SmartFetchOptions, SmartFetchResult } from './smart-fetch';
export type { BlockType, BlockDetectionResult } from './block-detection';

// Default export is smartFetch
export { smartFetch as default } from './smart-fetch';
