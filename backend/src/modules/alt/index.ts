/**
 * Alt-account analysis module (§8.2). A library composed by the players module,
 * not a Fastify module.
 */
export {
  AltService,
  HIGH_CONFIDENCE_MAX_ACCOUNT_AGE_DAYS,
  RECENTLY_SEEN_MS,
  YOUNG_ACCOUNT_DAYS,
  type AltAnalysis,
  type AltAnalyzeInput,
  type AltServiceOptions,
} from './service';
