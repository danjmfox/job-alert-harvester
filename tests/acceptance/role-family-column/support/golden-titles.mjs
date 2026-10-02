// The golden table: generic, real-shaped advert titles and the family each must land in (DR-0014, ratified order).
// Titles are synthetic and generic by design; none is copied from the operator's cache.
// One source for the pure classifier scenarios and for the scenarios through `build`.
//   kind: 'family'   one row per illustrated pattern, plain
//         'contested' the nine real-shaped cases the DESIGN names (Q4 table, rows 1 to 9)
//         'multi'    a title carrying qualifiers of two families (OQ-1 ratified answer)
//         'boundary' a title that a loose substring match would get wrong
//         'other'    a title no pattern matches

import { FamilyName as F } from './family-names.mjs';

const row = (kind, title, family, covers = null) => Object.freeze({ kind, title, family, covers });

export const GOLDEN_TITLES = Object.freeze([
  // agile coach
  row('family', 'Enterprise Agile Coach', F.AGILE_COACH, 'enterprise agile coach'),
  row('family', 'Senior Agile Coach (6 month contract)', F.AGILE_COACH, 'agile coach'),
  row('family', 'Business Agility Lead', F.AGILE_COACH, 'business agility'),
  row('family', 'Agile Transformation Coach', F.AGILE_COACH, 'agile transformation coach'),
  row('multi', 'Lead Agile Coach / Transformation Lead', F.AGILE_COACH),
  row('multi', 'Scrum Master / Agile Coach', F.AGILE_COACH),
  // scrum master
  row('family', 'Scrum Master', F.SCRUM_MASTER, 'scrum master'),
  row('family', 'Senior Scrum Master (Contract)', F.SCRUM_MASTER, 'scrum master'),
  // AI transformation
  row('family', 'Artificial Intelligence Transformation Manager', F.AI_TRANSFORMATION, 'artificial intelligence transformation'),
  row('family', 'Head of AI Transformation', F.AI_TRANSFORMATION, 'ai transformation'),
  // transformation/change
  row('family', 'Transformation Director', F.TRANSFORMATION_CHANGE, 'transformation'),
  row('family', 'Digital Transformation Lead', F.TRANSFORMATION_CHANGE, 'transformation'),
  row('family', 'Change Manager', F.TRANSFORMATION_CHANGE, 'change manager'),
  row('family', 'Change Lead (Technology)', F.TRANSFORMATION_CHANGE, 'change lead'),
  row('boundary', 'Rail Transformation Lead', F.TRANSFORMATION_CHANGE),
  // engineering/delivery manager
  row('family', 'Delivery Manager', F.DELIVERY_MANAGER, 'delivery manager'),
  row('family', 'Delivery Lead', F.DELIVERY_MANAGER, 'delivery lead'),
  row('family', 'Engineering Manager', F.DELIVERY_MANAGER, 'engineering manager'),
  row('family', 'Project Manager', F.DELIVERY_MANAGER, 'project manager'),
  row('family', 'Technical Delivery Manager', F.DELIVERY_MANAGER, 'delivery manager'),
  // product/product ops
  row('family', 'Product Manager', F.PRODUCT, 'product manager'),
  row('family', 'Product Operations Manager', F.PRODUCT, 'product operations'),
  row('family', 'Product Ops Lead', F.PRODUCT, 'product ops'),
  row('family', 'Senior Product Owner (Payments)', F.PRODUCT, 'product owner'),
  // the nine contested cases, DESIGN Q4 table rows 1 to 9
  row('contested', 'Agile Coach', F.AGILE_COACH),
  row('contested', 'Scrum Master / Agile Delivery Lead', F.SCRUM_MASTER),
  row('contested', 'AI Transformation Lead', F.AI_TRANSFORMATION, 'ai transformation'),
  row('contested', 'Business Change Manager', F.TRANSFORMATION_CHANGE, 'business change'),
  row('contested', 'Head of Delivery', F.DELIVERY_MANAGER, 'head of delivery'),
  row('contested', 'Programme Manager', F.DELIVERY_MANAGER, 'programme manager'),
  row('contested', 'Senior Engineering Manager', F.DELIVERY_MANAGER),
  row('contested', 'Product Owner', F.PRODUCT, 'product owner'),
  row('contested', 'Technical Product Manager', F.PRODUCT),
  // the two multi-qualifier titles, ratified answers (OQ-1)
  row('multi', 'Product Delivery Manager', F.DELIVERY_MANAGER),
  row('multi', 'Transformation Delivery Manager', F.TRANSFORMATION_CHANGE),
  // no pattern matches
  row('other', 'Data Analyst', F.OTHER),
  row('other', 'Java Developer', F.OTHER),
  row('other', 'Marketing Executive', F.OTHER),
  row('other', 'Customer Support Advisor', F.OTHER),
  row('other', 'Chief Financial Officer', F.OTHER),
  row('other', 'Warehouse Operative', F.OTHER),
  row('other', 'Registered Nurse', F.OTHER),
  row('other', 'Software Engineer', F.OTHER),
  row('other', 'Business Analyst', F.OTHER),
  row('other', 'Office Administrator', F.OTHER),
]);

/** The titles a family owns in the golden table, in table order. */
export const goldenTitlesOf = (family) => GOLDEN_TITLES.filter((entry) => entry.family === family);

/** Case, punctuation and whitespace variants of a family title, with the family each must still land in. */
export const TITLE_VARIANTS = Object.freeze([
  Object.freeze({ title: 'SCRUM MASTER (contract)', family: F.SCRUM_MASTER }),
  Object.freeze({ title: 'Scrum-Master', family: F.SCRUM_MASTER }),
  Object.freeze({ title: 'scrum    master', family: F.SCRUM_MASTER }),
  Object.freeze({ title: 'Scrum Master - London', family: F.SCRUM_MASTER }),
  Object.freeze({ title: 'AGILE COACH.', family: F.AGILE_COACH }),
  Object.freeze({ title: 'agile coach!!', family: F.AGILE_COACH }),
  Object.freeze({ title: '  Product   Owner  ', family: F.PRODUCT }),
  Object.freeze({ title: 'Programme-Manager', family: F.DELIVERY_MANAGER }),
  Object.freeze({ title: 'Scrüm Mästér', family: F.SCRUM_MASTER }),
  Object.freeze({ title: 'Scrum Master 🚀', family: F.SCRUM_MASTER }),
]);
