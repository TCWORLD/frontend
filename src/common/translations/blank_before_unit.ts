import type { FrontendLocaleData } from "../../data/translation";
import { PERCENTAGE, DEGREE } from "../unit-conversion/const";
import { blankBeforePercent } from "./blank_before_percent";

export const blankBeforeUnit = (
  unit: string,
  localeOptions: FrontendLocaleData | undefined
): string => {
  if (unit === DEGREE) {
    return "";
  }
  if (localeOptions && unit === PERCENTAGE) {
    return blankBeforePercent(localeOptions);
  }
  return " ";
};
