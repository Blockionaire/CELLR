/**
 * THE SERVER'S DOOR TO THE ENGINES: food intelligence, wine reading and the pairing engine, with their knowledge
 * (hundreds of dishes, ingredients, appellations and grapes). Import it as `@cellr/domain/intelligence`, and only
 * from server code: the knowledge is large and is CELLR's own work, so it is never shipped to a browser. Screens
 * get answers through /api/v1, in the shapes exported from the package's main entry.
 *
 * apps/web forbids this import to client code (ESLint) and apps/web/src/test/domain-entries.test.ts proves the main entry cannot reach
 * the knowledge by accident.
 *
 * `server-only` makes a build fail when this file ends up in a browser bundle, whatever path the import took.
 */
import "server-only";

export * from "./food/types";
export * from "./food/compose";
export * from "./food/parse";
export * from "./food/knowledge";
export * from "./pairing-engine/wine";
export * from "./pairing-engine/assess";
export * from "./pairing-engine/decide";
export * from "./pairing-engine/taste";
export * from "./pairing-engine/knowledge";
