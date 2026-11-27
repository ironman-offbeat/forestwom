import type { CaseRecord } from "./portal-api";
import { validateResult as validate } from "../shared/result-validation.mjs";
export function validateResult(result: unknown, record: CaseRecord): void {
  validate(result, record);
}
