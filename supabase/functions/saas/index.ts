import Papa from "npm:papaparse@5.4.1";
import "../../../analyzer.js";
import { createHandler } from "./handler.mjs";
// Shared, pure report normalization; no browser APIs are used by analyzer.js.
// @ts-ignore Global populated by the shared analysis module.
const prepareTable = globalThis.CSVAnalysis.prepareTable;
Deno.serve(createHandler({ env: (name: string) => Deno.env.get(name), Papa, prepareTable }));
