// The seven family labels exactly as the operator's pivots group by them (DR-0014 decision 7, SD-09).
// A rename is a decision, not a refactor: this enum is the test-side pin of the ratified spelling.
/** The header of the derived Jobs column. */
export const ROLE_FAMILY_COLUMN = 'Role Family';

export const FamilyName = Object.freeze({
  AGILE_COACH: 'agile coach',
  SCRUM_MASTER: 'scrum master',
  AI_TRANSFORMATION: 'AI transformation',
  TRANSFORMATION_CHANGE: 'transformation/change',
  DELIVERY_MANAGER: 'engineering/delivery manager',
  PRODUCT: 'product/product ops',
  OTHER: 'other',
});

/** The descriptor order the human ratified (OQ-1): first match wins, so this is the priority. */
export const FAMILY_PRIORITY_ORDER = Object.freeze([
  FamilyName.AGILE_COACH,
  FamilyName.SCRUM_MASTER,
  FamilyName.AI_TRANSFORMATION,
  FamilyName.TRANSFORMATION_CHANGE,
  FamilyName.DELIVERY_MANAGER,
  FamilyName.PRODUCT,
]);

export const CLOSED_FAMILY_SET = Object.freeze([...FAMILY_PRIORITY_ORDER, FamilyName.OTHER]);
